import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/server/db";
import { user } from "@/server/db/auth-schema";
import {
	brokerOrders,
	investmentSourceAccounts,
	investmentSourcePositions,
} from "@/server/db/schema";
import {
	beginTradingLogin,
	discardPreview,
	disconnectTrading,
	listOrders,
	previewOrder,
	resetOpenPreviewsForTests,
	submitOrder,
	tradingStatus,
} from "@/server/services/broker-orders";

const d =
	process.env.FORTUNA_INTEGRATION_TEST === "1" ? describe : describe.skip;

/**
 * A stand-in for Scalable's CLI. It never reaches Scalable: it prints a
 * preview with a confirmation id, accepts phase 2 only with that id, and
 * appends every call and the config it ran under to a log the test reads.
 */
function fakeCli(logPath: string, requireAck: boolean) {
	const expires = Math.floor(Date.now() / 1000) + 300;
	return `#!/bin/sh
set -eu
dir="$XDG_CONFIG_HOME/scalable-cli"
echo "ARGS $*" >> "${logPath}"
if [ "$1" = login ]; then
  printf 'Open this URL:\\nhttps://login.scalable.capital/device?user_code=TRADE-1\\n\\nVerify the code TRADE-1 in your browser.\\n'
  printf '%s' '{"session":{"access_token":"trade-access","refresh_token":"trade-refresh"}}' > "$dir/session.json"
  printf '%s' '{"kty":"EC","crv":"P-256","d":"trade-scalar"}' > "$dir/auth-signing-key.json"
  exit 0
fi
if [ "$1" = logout ]; then exit 0; fi
if [ "$1" = broker ] && [ "$2" = trade ]; then
  echo "CONFIG $(tr '\\n' '|' < "$dir/config.toml")" >> "${logPath}"
  case "$*" in
    *--confirm*)
      case "$*" in
        *"--confirm conf-777"*) printf '%s' '{"ok":true,"data":{"result":{"status":"SUBMITTED"}}}' ;;
        *) printf '%s' '{"ok":false,"error":{"code":"confirmation_not_found"}}'; exit 10 ;;
      esac ;;
    *)
      printf '%s' '{"ok":true,"data":{"result":{"intent":{"isin":"LU2903252349","order_type":"market","venue_override":null,"locale":"de"},"market_quote":{"mid_price":"12.15","ask_price":"12.16","bid_price":"12.14","currency":"EUR","is_outdated":false,"timestamp_utc":"2026-09-28T09:00:00Z"},"calculation":{"shares":"41.1184","estimated_order_volume_raw":"500.00","estimated_order_volume":"500,00 €"},"tradability":{"status":"TRADABLE","selected_venue":"XETR","selected_venue_label":"Xetra","selected_venue_status":"OPEN","selected_venue_unavailability_reason":null,"requires_appropriateness":${requireAck},"tradable":true},"warning":null,"price_warnings":{"items":[]},"ex_ante_costs":{"id":"cost-1","entryCosts":{"total":{"amount":"0,99 €","percentage":"0,20 %"}}},"suitability":{"status":"OK"},"regulatory_disclosures":{"execution_instruction":"Ausführung an der Börse"},"document_links":{"client_documents":[],"primary_kid":"https://example.invalid/kid.pdf","secondary_kid":null}},"confirmation":{"id":"conf-777","expires_at_epoch":${expires}}}}' ;;
  esac
  exit 0
fi
exit 9
`;
}

d("orders at Scalable", () => {
	const userId = `it-${randomUUID()}`;
	let directory = "";
	let logPath = "";
	const previous = process.env.FORTUNA_SCALABLE_CLI_BIN;

	const install = async (requireAck: boolean) => {
		const binary = join(directory, "sc");
		await writeFile(binary, fakeCli(logPath, requireAck));
		await chmod(binary, 0o700);
		process.env.FORTUNA_SCALABLE_CLI_BIN = binary;
	};
	const log = async () =>
		(await readFile(logPath, "utf8")).split("\n").filter(Boolean);

	beforeAll(async () => {
		directory = await mkdtemp(join(tmpdir(), "fortuna-orders-"));
		logPath = join(directory, "calls.log");
		await writeFile(logPath, "");
		await install(false);
		await db.insert(user).values({
			id: userId,
			name: "Orders",
			email: `${userId}@example.invalid`,
		});
		const [depot] = await db
			.insert(investmentSourceAccounts)
			.values({
				userId,
				provider: "scalable",
				sourceAccountId: "broker:orders-portfolio",
				method: "cli",
				currency: "EUR",
				status: "active",
			})
			.returning();
		await db.insert(investmentSourcePositions).values({
			userId,
			accountId: depot.id,
			instrumentName: "Scalable MSCI AC World Xtrackers (Acc)",
			isin: "LU2903252349",
			quantity: 592,
			valueMinor: 719_339,
			currency: "EUR",
			verification: "provider_reported",
		});
	});

	afterAll(async () => {
		resetOpenPreviewsForTests();
		process.env.FORTUNA_SCALABLE_CLI_BIN = previous;
		await db.delete(user).where(eq(user.id, userId));
		await rm(directory, { recursive: true, force: true });
		await pool.end();
	});

	it("refuses to preview before trading is unlocked", async () => {
		await expect(
			previewOrder(userId, {
				side: "buy",
				isin: "LU2903252349",
				amountMinor: 50_000,
			}),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	});

	it("unlocks trading with its own login, without the read-only guard", async () => {
		const prompt = await beginTradingLogin(userId);
		expect(prompt).toMatchObject({ code: "TRADE-1" });
		let status = await tradingStatus(userId);
		for (let i = 0; i < 40 && !status.connected; i++) {
			await new Promise((resolve) => setTimeout(resolve, 50));
			status = await tradingStatus(userId);
		}
		expect(status.connected).toBe(true);
		expect(await log()).toContain("ARGS login");
		expect((await log()).join("\n")).not.toContain("--local-read-only");
	});

	it("previews only instruments already in the depot", async () => {
		await expect(
			previewOrder(userId, {
				side: "buy",
				isin: "IE00B4L5Y983",
				amountMinor: 50_000,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			previewOrder(userId, {
				side: "sell",
				isin: "LU2903252349",
				shares: 593,
				reason: "Rebalancing nach meinen Regeln.",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("refuses a sale preview without the owner's reason, before Scalable", async () => {
		const before = (await log()).length;
		const rowsBefore = (await listOrders(userId)).length;
		for (const reason of ["", "   ", "weil halt"])
			await expect(
				previewOrder(userId, {
					side: "sell",
					isin: "LU2903252349",
					shares: 2,
					reason,
				}),
			).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			// A caller that leaves the field out entirely is refused too.
			previewOrder(userId, {
				side: "sell",
				isin: "LU2903252349",
				shares: 2,
			} as never),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect((await log()).slice(before)).toEqual([]);
		expect(await listOrders(userId)).toHaveLength(rowsBefore);
	});

	it("stores the reason with the sale and lists it; a buy needs none", async () => {
		const sale = await previewOrder(userId, {
			side: "sell",
			isin: "LU2903252349",
			shares: 2,
			reason: "  Ich brauche das Geld\n im Frühjahr für die Wohnung. ",
		});
		const buy = await previewOrder(userId, {
			side: "buy",
			isin: "LU2903252349",
			amountMinor: 20_000,
			// Not part of a buy: ignored, never stored.
			reason: "irrelevant für einen Kauf",
		} as never);
		const listed = await listOrders(userId);
		expect(listed.find((order) => order.id === sale.orderId)).toMatchObject({
			side: "sell",
			sellReason: "Ich brauche das Geld im Frühjahr für die Wohnung.",
		});
		expect(
			listed.find((order) => order.id === buy.orderId)?.sellReason,
		).toBeNull();
		// The reason is Fortuna's record only: it never reaches the CLI.
		expect((await log()).join("\n")).not.toContain("Wohnung");
		await discardPreview(userId, sale.orderId);
		await discardPreview(userId, buy.orderId);
	});

	it("places nothing on preview and locks the workspace to the order", async () => {
		const before = (await log()).length;
		const preview = await previewOrder(userId, {
			side: "buy",
			isin: "LU2903252349",
			amountMinor: 50_000,
		});
		expect(preview.tradable).toBe(true);
		expect(preview.requiresAcknowledgement).toBe(false);
		const rows = preview.disclosure.flatMap((section) => section.rows);
		expect(rows.find((row) => row.path === "/confirmation/id")?.lines).toEqual([
			"conf-777",
		]);
		expect(
			rows.find((row) => row.path === "/result/warning/body")?.lines,
		).toEqual(["(nicht geliefert)"]);
		const calls = (await log()).slice(before);
		expect(calls).toContain(
			"ARGS broker trade buy --isin LU2903252349 --amount 500.00 --order-type market --json",
		);
		expect(calls.some((line) => line.includes("--confirm"))).toBe(false);
		const config = calls.find((line) => line.startsWith("CONFIG")) ?? "";
		expect(config).toContain('allowed_isins = ["LU2903252349"]');
		expect(config).toContain('max_order_notional = "505.00"');

		const submitted = await submitOrder(userId, {
			orderId: preview.orderId,
			acknowledged: false,
		});
		expect(submitted.status).toBe("submitted");
		const phase2 = (await log()).slice(before);
		expect(phase2).toContain(
			"ARGS broker trade buy --isin LU2903252349 --amount 500.00 --order-type market --confirm conf-777 --json",
		);
		// A confirmation is used once.
		await expect(
			submitOrder(userId, { orderId: preview.orderId, acknowledged: false }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		const logged = await listOrders(userId);
		expect(logged[0]).toMatchObject({ status: "submitted", side: "buy" });
		// Orders come straight from "Anlegen"; no decision ticket is written.
		const [row] = await db
			.select({ decisionId: brokerOrders.decisionId })
			.from(brokerOrders)
			.where(eq(brokerOrders.id, preview.orderId));
		expect(row.decisionId).toBeNull();
	});

	it("needs the owner to acknowledge a required warning", async () => {
		await install(true);
		const preview = await previewOrder(userId, {
			side: "buy",
			isin: "LU2903252349",
			amountMinor: 1_000_000,
		});
		expect(preview.requiresAcknowledgement).toBe(true);
		await expect(
			submitOrder(userId, { orderId: preview.orderId, acknowledged: false }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		const before = (await log()).length;
		await submitOrder(userId, { orderId: preview.orderId, acknowledged: true });
		expect((await log()).slice(before)).toContain(
			"ARGS broker trade buy --isin LU2903252349 --amount 10000.00 --order-type market --confirm conf-777 --acknowledge-appropriateness-warning --json",
		);
	});

	it("never lets another user confirm the owner's preview", async () => {
		await install(false);
		const preview = await previewOrder(userId, {
			side: "sell",
			isin: "LU2903252349",
			shares: 2,
			reason: "Rebalancing nach meinen Regeln.",
		});
		await expect(
			submitOrder("someone-else", {
				orderId: preview.orderId,
				acknowledged: false,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		const [row] = await db
			.select()
			.from(brokerOrders)
			.where(eq(brokerOrders.id, preview.orderId));
		expect(row.status).toBe("previewed");
	});

	it("locks trading again", async () => {
		await disconnectTrading(userId);
		expect((await tradingStatus(userId)).connected).toBe(false);
		await expect(
			previewOrder(userId, {
				side: "buy",
				isin: "LU2903252349",
				amountMinor: 50_000,
			}),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	});
});
