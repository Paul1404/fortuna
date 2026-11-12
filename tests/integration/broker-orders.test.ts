import { randomUUID } from "node:crypto";
import {
	access,
	chmod,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/server/db";
import { user } from "@/server/db/auth-schema";
import {
	brokerOrders,
	externalConnections,
	investmentSourceAccounts,
	investmentSourcePositions,
	scalableDeviceLogins,
} from "@/server/db/schema";
import { SCALABLE_TRADE_COMMAND_TIMEOUT_MS } from "@/server/providers/investment/scalable-hosted-cli";
import {
	beginTradingLogin,
	createTradingSessionRotationWriter,
	discardPreview,
	disconnectTrading,
	listOrders,
	previewOrder,
	resetOpenPreviewsForTests,
	resolveUnknownSubmission,
	submitOrder,
	tradingStatus,
} from "@/server/services/broker-orders";
import { cancelScalableDeviceLoginInDb } from "@/server/services/scalable-device-login";

const d =
	process.env.FORTUNA_INTEGRATION_TEST === "1" ? describe : describe.skip;

/**
 * A stand-in for Scalable's CLI. It never reaches Scalable: it prints a
 * preview with a confirmation id, accepts phase 2 only with that id, and
 * appends every call and the config it ran under to a log the test reads.
 */
function fakeCli(
	logPath: string,
	requireAck: boolean,
	slowConfirm = false,
	confirmationOutcome: "accepted" | "ambiguous" | "rejected" = "accepted",
	loginWait = 0,
) {
	const expires = Math.floor(Date.now() / 1000) + 300;
	return `#!/bin/sh
set -eu
dir="$XDG_CONFIG_HOME/scalable-cli"
echo "ARGS $*" >> "${logPath}"
echo "ROOT $XDG_CONFIG_HOME" >> "${logPath}"
if [ "$1" = login ]; then
  printf 'Open this URL:\\nhttps://login.scalable.capital/device?user_code=TRADE-1\\n\\nVerify the code TRADE-1 in your browser.\\n'
  printf '%s' '{"session":{"access_token":"trade-access","refresh_token":"trade-refresh"}}' > "$dir/session.json"
  printf '%s' '{"kty":"EC","crv":"P-256","d":"trade-scalar"}' > "$dir/auth-signing-key.json"
  ${loginWait > 0 ? `sleep ${loginWait}` : ":"}
  exit 0
fi
if [ "$1" = logout ]; then exit 0; fi
if [ "$1" = broker ] && [ "$2" = trade ]; then
  echo "CONFIG $(tr '\\n' '|' < "$dir/config.toml")" >> "${logPath}"
  case "$*" in
    *--confirm*)
      test -f "$dir/trade_confirmation.json"
      grep -q '"confirmation_id":"conf-777"' "$dir/trade_confirmation.json"
      echo "CONFIRMATION $(cat "$dir/trade_confirmation.json")" >> "${logPath}"
      ${slowConfirm ? "sleep 1" : ":"}
      ${confirmationOutcome === "ambiguous" ? "printf '%s' '{' ; exit 0" : ":"}
      ${confirmationOutcome === "rejected" ? 'printf \'%s\' \'{"ok":false,"error":{"code":"not_tradable"}}\' ; exit 10' : ":"}
      case "$*" in
        *"--confirm conf-777"*) printf '%s' '{"ok":true,"data":{"result":{"status":"SUBMITTED"}}}' ;;
        *) printf '%s' '{"ok":false,"error":{"code":"confirmation_not_found"}}'; exit 10 ;;
      esac ;;
    *)
      printf '%s' '{"pending":{"confirmation_id":"conf-777","nonce":"fake-nonce"}}' > "$dir/trade_confirmation.json"
      printf '%s' '{"ok":true,"data":{"result":{"intent":{"isin":"LU2903252349","order_type":"market","limit_price":null,"stop_price":null,"venue_override":null,"locale":"de"},"market_quote":{"mid_price":"12.15","ask_price":"12.16","bid_price":"12.14","currency":"EUR","is_outdated":false,"timestamp_utc":"2026-09-28T09:00:00Z"},"calculation":{"shares":"41.1184","estimated_order_volume_raw":"500.00","estimated_order_volume":"500,00 €"},"tradability":{"status":"TRADABLE","selected_venue":"XETR","selected_venue_label":"Xetra","selected_venue_status":"OPEN","selected_venue_unavailability_reason":null,"requires_appropriateness":${requireAck},"tradable":true},"warning":null,"price_warnings":{"items":[]},"ex_ante_costs":{"id":"cost-1","entryCosts":{"total":{"amount":"0,99 €","percentage":"0,20 %"}}},"suitability":{"status":"OK"},"regulatory_disclosures":{"execution_instruction":"Ausführung an der Börse"},"document_links":{"client_documents":[],"primary_kid":"https://example.invalid/kid.pdf","secondary_kid":null}},"confirmation":{"id":"conf-777","expires_at_epoch":${expires}}}}' ;;
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

	const install = async (
		requireAck: boolean,
		slowConfirm = false,
		confirmationOutcome: "accepted" | "ambiguous" | "rejected" = "accepted",
		loginWait = 0,
	) => {
		const binary = join(directory, "sc");
		await writeFile(
			binary,
			fakeCli(logPath, requireAck, slowConfirm, confirmationOutcome, loginWait),
		);
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
		await install(false, false, "accepted", 1);
		const [prompt, secondPrompt] = await Promise.all([
			beginTradingLogin(userId),
			beginTradingLogin(userId),
		]);
		expect(prompt).toMatchObject({ code: "TRADE-1" });
		expect(secondPrompt).toEqual(prompt);
		const pendingStatus = await tradingStatus(userId);
		expect(pendingStatus.pendingLogin).toMatchObject({ code: "TRADE-1" });
		const pendingRow = await db.query.scalableDeviceLogins.findFirst({
			where: eq(scalableDeviceLogins.userId, userId),
		});
		expect(pendingRow).toMatchObject({
			provider: "scalable_trading_cli",
			status: "pending",
			generation: 1,
		});
		expect(pendingRow?.encryptedPrompt).not.toContain("TRADE-1");
		let status = await tradingStatus(userId);
		for (let i = 0; i < 40 && !status.connected; i++) {
			await new Promise((resolve) => setTimeout(resolve, 50));
			status = await tradingStatus(userId);
		}
		expect(status.connected).toBe(true);
		expect((await log()).filter((line) => line === "ARGS login")).toHaveLength(
			1,
		);
		expect((await log()).join("\n")).not.toContain("--local-read-only");
	});

	it("rejects a trading rotation from a disconnected or replaced session", async () => {
		const original = await db.query.externalConnections.findFirst({
			where: eq(externalConnections.userId, userId),
		});
		expect(original?.encryptedSecret).toBeTruthy();
		const staleWriter = createTradingSessionRotationWriter(
			original?.id ?? "missing",
			original?.encryptedSecret ?? "missing",
		);
		await disconnectTrading(userId);
		await expect(
			staleWriter({ session: "late-session", signingKey: "late-key" }),
		).rejects.toMatchObject({ code: "TRADING_SESSION_CHANGED" });

		await install(false);
		await beginTradingLogin(userId);
		let status = await tradingStatus(userId);
		for (let i = 0; i < 40 && !status.connected; i++) {
			await new Promise((resolve) => setTimeout(resolve, 50));
			status = await tradingStatus(userId);
		}
		expect(status.connected).toBe(true);
		const reconnected = await db.query.externalConnections.findFirst({
			where: eq(externalConnections.userId, userId),
		});
		expect(reconnected?.encryptedSecret).not.toBe(original?.encryptedSecret);
		await expect(
			staleWriter({ session: "late-session-2", signingKey: "late-key-2" }),
		).rejects.toMatchObject({ code: "TRADING_SESSION_CHANGED" });
		expect(
			(
				await db.query.externalConnections.findFirst({
					where: eq(externalConnections.userId, userId),
				})
			)?.encryptedSecret,
		).toBe(reconnected?.encryptedSecret);
	});

	it("cancels a trading login owned by another replica", async () => {
		const remoteUser = `it-${randomUUID()}`;
		await db.insert(user).values({
			id: remoteUser,
			name: "Remote login",
			email: `${remoteUser}@example.invalid`,
		});
		try {
			await install(false, false, "accepted", 3);
			expect(await beginTradingLogin(remoteUser)).toMatchObject({
				code: "TRADE-1",
			});
			await cancelScalableDeviceLoginInDb(remoteUser, "scalable_trading_cli");
			await new Promise((resolve) => setTimeout(resolve, 1_200));
			expect(await tradingStatus(remoteUser)).toMatchObject({
				connected: false,
				status: "disconnected",
				pendingLogin: null,
			});
			const state = await db.query.scalableDeviceLogins.findFirst({
				where: eq(scalableDeviceLogins.userId, remoteUser),
			});
			expect(state).toMatchObject({
				provider: "scalable_trading_cli",
				status: "cancelled",
				generation: 2,
				encryptedPrompt: null,
			});
		} finally {
			await db.delete(user).where(eq(user.id, remoteUser));
		}
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
		const previewRoot = (await log())
			.filter((line) => line.startsWith("ROOT "))
			.at(-1)
			?.slice("ROOT ".length);
		expect(previewRoot).toBeTruthy();
		// Simulate confirmation reaching a fresh replica with no local preview state.
		resetOpenPreviewsForTests();
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
		if (previewRoot) await expect(access(previewRoot)).rejects.toThrow();
		const phase2 = (await log()).slice(before);
		expect(phase2).toContain(
			'CONFIRMATION {"pending":{"confirmation_id":"conf-777","nonce":"fake-nonce"}}',
		);
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

	it("serializes confirmations for distinct orders across service state", async () => {
		await install(false, true);
		const first = await previewOrder(userId, {
			side: "buy",
			isin: "LU2903252349",
			amountMinor: 30_000,
		});
		const second = await previewOrder(userId, {
			side: "buy",
			isin: "LU2903252349",
			amountMinor: 40_000,
		});
		const before = (await log()).length;
		const outcomes = await Promise.allSettled([
			submitOrder(userId, { orderId: first.orderId, acknowledged: false }),
			submitOrder(userId, { orderId: second.orderId, acknowledged: false }),
		]);
		expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(
			1,
		);
		expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(
			1,
		);
		expect(
			(await log())
				.slice(before)
				.filter(
					(line) =>
						line.startsWith("ARGS broker trade") && line.includes("--confirm"),
				),
		).toHaveLength(1);
		const rows = await listOrders(userId);
		const pending = [first.orderId, second.orderId].find(
			(id) => rows.find((row) => row.id === id)?.status === "previewed",
		);
		if (pending) await discardPreview(userId, pending);
		await install(false);
	});

	it("does not overwrite an owner assertion when a stale worker finishes", async () => {
		await install(false, true);
		const preview = await previewOrder(userId, {
			side: "buy",
			isin: "LU2903252349",
			amountMinor: 24_000,
		});
		const before = (await log()).length;
		const submitting = submitOrder(userId, {
			orderId: preview.orderId,
			acknowledged: false,
		});
		const outcome = submitting.then(
			() => "submitted",
			() => "rejected",
		);
		for (let i = 0; i < 50; i++) {
			if (
				(await log())
					.slice(before)
					.some((line) => line.startsWith("CONFIRMATION "))
			)
				break;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		expect(
			(await log())
				.slice(before)
				.some((line) => line.startsWith("CONFIRMATION ")),
		).toBe(true);
		// Simulate an owner reconciliation after the worker's advisory lock is lost.
		await db
			.update(brokerOrders)
			.set({
				status: "owner_asserted_not_submitted",
				errorCode: "SUBMISSION_UNKNOWN",
			})
			.where(eq(brokerOrders.id, preview.orderId));
		expect(await outcome).toBe("rejected");
		expect(
			(await listOrders(userId)).find((item) => item.id === preview.orderId),
		).toMatchObject({
			status: "owner_asserted_not_submitted",
			submittedAt: null,
		});
		await install(false);
	});

	it("keeps a post-submit ambiguous result unresolved and blocks retries", async () => {
		await install(false, true, "ambiguous");
		const preview = await previewOrder(userId, {
			side: "buy",
			isin: "LU2903252349",
			amountMinor: 25_000,
		});
		const before = (await log()).length;
		const submitting = submitOrder(userId, {
			orderId: preview.orderId,
			acknowledged: false,
		});
		for (let i = 0; i < 50; i++) {
			if ((await log()).some((line) => line.startsWith("CONFIRMATION "))) break;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		expect((await log()).some((line) => line.startsWith("CONFIRMATION "))).toBe(
			true,
		);
		await expect(
			resolveUnknownSubmission(userId, {
				orderId: preview.orderId,
				outcome: "not_found",
				confirmed: true,
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(submitting).rejects.toMatchObject({ code: "BAD_GATEWAY" });
		await expect(
			resolveUnknownSubmission("someone-else", {
				orderId: preview.orderId,
				outcome: "not_found",
				confirmed: true,
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		const order = (await listOrders(userId)).find(
			(item) => item.id === preview.orderId,
		);
		expect(order).toMatchObject({
			status: "submitting",
			errorCode: "SUBMISSION_UNKNOWN",
		});
		await expect(
			submitOrder(userId, { orderId: preview.orderId, acknowledged: false }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(
			previewOrder(userId, {
				side: "buy",
				isin: "LU2903252349",
				amountMinor: 26_000,
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		const calls = (await log()).slice(before);
		expect(
			calls.filter(
				(line) =>
					line.startsWith("ARGS broker trade") && line.includes("--confirm"),
			),
		).toHaveLength(1);
		await expect(
			resolveUnknownSubmission(userId, {
				orderId: preview.orderId,
				outcome: "not_found",
				confirmed: true,
			}),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		const resolutionReadyAt = new Date(
			Date.now() - SCALABLE_TRADE_COMMAND_TIMEOUT_MS - 30_000,
		);
		await db
			.update(brokerOrders)
			.set({ confirmedAt: resolutionReadyAt })
			.where(eq(brokerOrders.id, preview.orderId));
		const beforeResolution = (await log()).length;
		const notFound = await resolveUnknownSubmission(userId, {
			orderId: preview.orderId,
			outcome: "not_found",
			confirmed: true,
		});
		expect(notFound).toMatchObject({
			status: "owner_asserted_not_submitted",
			assertionRecorded: true,
		});
		const recordedNotFound = (await listOrders(userId)).find(
			(item) => item.id === preview.orderId,
		);
		expect(recordedNotFound).toMatchObject({
			status: "owner_asserted_not_submitted",
			errorCode: "SUBMISSION_UNKNOWN",
			submittedAt: null,
		});
		const [notFoundAudit] = await db
			.select({ updatedAt: brokerOrders.updatedAt })
			.from(brokerOrders)
			.where(eq(brokerOrders.id, preview.orderId));
		expect(notFoundAudit.updatedAt.getTime()).toBeGreaterThan(
			resolutionReadyAt.getTime(),
		);
		expect((await log()).length).toBe(beforeResolution);
		const freshPreview = await previewOrder(userId, {
			side: "buy",
			isin: "LU2903252349",
			amountMinor: 26_000,
		});
		await discardPreview(userId, freshPreview.orderId);

		// The v1.2.0 CLI can submit before reporting a global error with exit 10.
		await install(false, false, "rejected");
		const secondPreview = await previewOrder(userId, {
			side: "buy",
			isin: "LU2903252349",
			amountMinor: 26_500,
		});
		await expect(
			submitOrder(userId, {
				orderId: secondPreview.orderId,
				acknowledged: false,
			}),
		).rejects.toMatchObject({ code: "BAD_GATEWAY" });
		expect(
			(await listOrders(userId)).find(
				(item) => item.id === secondPreview.orderId,
			),
		).toMatchObject({ status: "submitting", errorCode: "SUBMISSION_UNKNOWN" });
		const secondResolutionReadyAt = new Date(
			Date.now() - SCALABLE_TRADE_COMMAND_TIMEOUT_MS - 30_000,
		);
		await db
			.update(brokerOrders)
			.set({ confirmedAt: secondResolutionReadyAt })
			.where(eq(brokerOrders.id, secondPreview.orderId));
		const beforeSecondResolution = (await log()).length;
		const found = await resolveUnknownSubmission(userId, {
			orderId: secondPreview.orderId,
			outcome: "found",
			confirmed: true,
		});
		expect(found.status).toBe("owner_asserted_submitted");
		const recordedFound = (await listOrders(userId)).find(
			(item) => item.id === secondPreview.orderId,
		);
		expect(recordedFound).toMatchObject({
			status: "owner_asserted_submitted",
			errorCode: "SUBMISSION_UNKNOWN",
			submittedAt: null,
		});
		const [providerRecord] = await db
			.select({ encryptedResult: brokerOrders.encryptedResult })
			.from(brokerOrders)
			.where(eq(brokerOrders.id, secondPreview.orderId));
		expect(providerRecord.encryptedResult).toBeNull();
		expect((await log()).length).toBe(beforeSecondResolution);
	});

	it("marks a CLI that never starts failed and permits a fresh preview", async () => {
		await install(false);
		const preview = await previewOrder(userId, {
			side: "buy",
			isin: "LU2903252349",
			amountMinor: 27_000,
		});
		await rm(join(directory, "sc"));
		await expect(
			submitOrder(userId, { orderId: preview.orderId, acknowledged: false }),
		).rejects.toMatchObject({ code: "BAD_GATEWAY" });
		expect(
			(await listOrders(userId)).find((item) => item.id === preview.orderId),
		).toMatchObject({ status: "failed", errorCode: "CLI_NOT_FOUND" });
		await install(false);
		const next = await previewOrder(userId, {
			side: "buy",
			isin: "LU2903252349",
			amountMinor: 28_000,
		});
		await discardPreview(userId, next.orderId);
	});

	it("keeps an accepted CLI result unresolved if its database write fails", async () => {
		const suffix = randomUUID().replaceAll("-", "");
		const functionName = `broker_result_fail_${suffix}`;
		const triggerName = `broker_result_fail_${suffix}`;
		await db.execute(
			sql.raw(`CREATE FUNCTION public.${functionName}() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.status = 'submitted' THEN
    RAISE EXCEPTION 'synthetic final persistence failure';
  END IF;
  RETURN NEW;
END $$`),
		);
		await db.execute(
			sql.raw(`CREATE TRIGGER ${triggerName} BEFORE UPDATE ON public.broker_orders
FOR EACH ROW EXECUTE FUNCTION public.${functionName}()`),
		);
		try {
			await install(false);
			const preview = await previewOrder(userId, {
				side: "buy",
				isin: "LU2903252349",
				amountMinor: 29_000,
			});
			const before = (await log()).length;
			await expect(
				submitOrder(userId, { orderId: preview.orderId, acknowledged: false }),
			).rejects.toMatchObject({ code: "BAD_GATEWAY" });
			expect(
				(await listOrders(userId)).find((item) => item.id === preview.orderId),
			).toMatchObject({
				status: "submitting",
				errorCode: "SUBMISSION_UNKNOWN",
			});
			expect(
				(await log())
					.slice(before)
					.filter(
						(line) =>
							line.startsWith("ARGS broker trade") &&
							line.includes("--confirm"),
					),
			).toHaveLength(1);
			await db
				.update(brokerOrders)
				.set({ status: "failed", errorCode: "TEST_RECONCILED" })
				.where(eq(brokerOrders.id, preview.orderId));
		} finally {
			await db.execute(
				sql.raw(
					`DROP TRIGGER IF EXISTS ${triggerName} ON public.broker_orders`,
				),
			);
			await db.execute(
				sql.raw(`DROP FUNCTION IF EXISTS public.${functionName}()`),
			);
		}
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
