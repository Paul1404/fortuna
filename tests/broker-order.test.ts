import { describe, expect, it } from "vitest";
import {
	disclosure,
	disclosureText,
	previewConfirmation,
	requiredLeafPaths,
	requiresAcknowledgement,
	validateOrderRequest,
} from "@/domain/broker-order";
import {
	allowedTradeArgs,
	cliAmount,
	cliShares,
	tradeArgs,
	tradeConfig,
} from "@/server/providers/investment/scalable-hosted-cli";
import leaves from "./fixtures/scalable-trade-leaves.json";

// `sc capabilities --json` of CLI v1.1.0: the fields the CLI requires to be
// shown before phase 2. The dialog must render every one of them.
describe("pre-trade disclosure", () => {
	it("covers exactly the CLI's required fields, per side", () => {
		expect(requiredLeafPaths("buy").sort()).toEqual([...leaves.buy].sort());
		expect(requiredLeafPaths("sell").sort()).toEqual([...leaves.sell].sort());
	});

	it("shows values unchanged, null literally and a missing field as missing", () => {
		expect(disclosureText("12,34")).toEqual(["12,34"]);
		expect(disclosureText(0.0012)).toEqual(["0.0012"]);
		expect(disclosureText(null)).toEqual(["null"]);
		expect(disclosureText(undefined)).toEqual(["(nicht geliefert)"]);
		expect(disclosureText([{ code: "SPREAD", text: "Weiter Spread" }])).toEqual(
			["code: SPREAD", "text: Weiter Spread"],
		);
		const rows = disclosure(
			{ result: { intent: { isin: "LU2903252349" } } },
			"buy",
		).flatMap((section) => section.rows);
		expect(rows).toHaveLength(71);
		expect(rows[0]).toMatchObject({ lines: ["LU2903252349"] });
	});

	it("reads the confirmation and whether a warning must be acknowledged", () => {
		const preview = {
			result: { tradability: { requires_appropriateness: true } },
			confirmation: { id: "c0nf-123", expires_at_epoch: 1_790_000_000 },
		};
		expect(previewConfirmation(preview)).toEqual({
			id: "c0nf-123",
			expiresAt: new Date(1_790_000_000_000),
		});
		expect(requiresAcknowledgement(preview)).toBe(true);
		expect(previewConfirmation({ confirmation: { id: "x y" } })).toBeNull();
	});
});

describe("order requests", () => {
	const held = [{ isin: "LU2903252349", quantity: 592 }];

	it("allows any amount, but only instruments already in the depot", () => {
		expect(
			validateOrderRequest(
				{ side: "buy", isin: "LU2903252349", amountMinor: 250_000_00 },
				held,
			),
		).toBeNull();
		expect(
			validateOrderRequest(
				{ side: "buy", isin: "IE00B4L5Y983", amountMinor: 100_00 },
				held,
			),
		).toContain("bereits im Depot");
	});

	it("never sells more than is held", () => {
		expect(
			validateOrderRequest(
				{ side: "sell", isin: "LU2903252349", shares: 593 },
				held,
			),
		).toContain("weniger Stücke");
		expect(
			validateOrderRequest(
				{ side: "sell", isin: "LU2903252349", shares: 592 },
				held,
			),
		).toBeNull();
	});
});

describe("trade commands", () => {
	it("formats amounts and shares for the CLI", () => {
		expect(cliAmount(123_456)).toBe("1234.56");
		expect(cliAmount(5)).toBe("0.05");
		expect(cliShares(10)).toBe("10");
		expect(cliShares(0.5)).toBe("0.5");
		expect(() => cliAmount(0)).toThrow();
		expect(() => cliShares(-1)).toThrow();
	});

	it("builds exactly one market order and confirms it with the same arguments", () => {
		const buy = tradeArgs({
			side: "buy",
			isin: "LU2903252349",
			amountMinor: 50_000,
		});
		expect(buy).toEqual([
			"broker",
			"trade",
			"buy",
			"--isin",
			"LU2903252349",
			"--amount",
			"500.00",
			"--order-type",
			"market",
		]);
		expect(allowedTradeArgs(buy)).toBe(true);
		expect(allowedTradeArgs([...buy, "--confirm", "abcd-1234"])).toBe(true);
		expect(
			allowedTradeArgs([
				...buy,
				"--confirm",
				"abcd-1234",
				"--acknowledge-appropriateness-warning",
			]),
		).toBe(true);
		const sell = tradeArgs({
			side: "sell",
			isin: "DE0007236101",
			shares: 2,
		});
		expect(allowedTradeArgs([...sell, "--confirm", "abcd-1234"])).toBe(true);
	});

	it("refuses everything else", () => {
		const buy = tradeArgs({
			side: "buy",
			isin: "LU2903252349",
			amountMinor: 50_000,
		});
		for (const args of [
			["broker", "trade", "cancel", "--order-id", "1"],
			["broker", "savings-plans", "add"],
			[...buy.slice(0, 8), "limit"],
			[...buy, "--venue", "XETR"],
			[...buy, "--confirm", "bad id"],
			[
				...tradeArgs({ side: "sell", isin: "DE0007236101", shares: 2 }),
				"--confirm",
				"abcd-1234",
				"--acknowledge-appropriateness-warning",
			],
			[
				"broker",
				"trade",
				"buy",
				"--isin",
				"not-an-isin",
				"--amount",
				"1.00",
				"--order-type",
				"market",
			],
		])
			expect(allowedTradeArgs(args)).toBe(false);
	});

	it("locks each order's workspace to its ISIN and confirmed amount", () => {
		const config = tradeConfig({
			side: "buy",
			isin: "LU2903252349",
			amountMinor: 50_000,
		});
		expect(config).toContain('allowed_isins = ["LU2903252349"]');
		expect(config).toContain('max_order_notional = "505.00"');
		const sell = tradeConfig({
			side: "sell",
			isin: "DE0007236101",
			shares: 2,
		});
		expect(sell).toContain('allowed_isins = ["DE0007236101"]');
		expect(sell).not.toContain("max_order_notional");
	});
});
