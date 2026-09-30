import { describe, expect, it } from "vitest";
import {
	computeMarketPulse,
	marketDisplayTarget,
	pulseMatchesConfirmed,
} from "@/domain/scalable-market-pulse";
import { parseScalableHoldingsPulse } from "@/server/providers/investment/scalable-cli";

const now = new Date("2026-09-17T12:00:00Z");
const isin = "IE00B4L5Y983";
const old = [
	{
		isin,
		quantity: 45,
		currency: "EUR",
		valueMinor: 450000,
		valuationAt: new Date("2026-09-17T11:55:00Z"),
		valuationSource: "scalable_valuation",
	},
];
const fresh = [
	{
		isin,
		name: "Beispiel ETF",
		quantity: 45,
		currency: "EUR",
		quotedValueMinor: 450900,
		reportedValueMinor: 450900,
		quoteAt: new Date("2026-09-17T11:59:00Z"),
		quoteOutdated: false,
	},
];

describe("Scalable market pulse", () => {
	it("attributes only an observed quote move against booked holdings", () => {
		expect(computeMarketPulse(old, fresh, now)).toMatchObject({
			movers: [{ isin, deltaMinor: 900 }],
			skipped: 0,
		});
	});
	it("never treats buys or stale quotes as gains", () => {
		expect(
			computeMarketPulse(old, [{ ...fresh[0], quantity: 46 }], now).movers,
		).toEqual([]);
		expect(
			computeMarketPulse(old, [{ ...fresh[0], quoteOutdated: true }], now)
				.movers,
		).toEqual([]);
		expect(
			computeMarketPulse(
				old,
				[{ ...fresh[0], quoteAt: new Date("2026-09-17T10:00:00Z") }],
				now,
			).movers,
		).toEqual([]);
		expect(
			computeMarketPulse(old, [{ ...fresh[0], quotedValueMinor: null }], now)
				.movers,
		).toEqual([]);
		expect(
			computeMarketPulse(
				[{ ...old[0], valuationSource: "scalable_fifo_cost" }],
				fresh,
				now,
			).movers,
		).toEqual([]);
	});
	it("validates identity and returns only bounded projection", () => {
		const parsed = parseScalableHoldingsPulse({
			account_id: "a",
			portfolio_id: "p",
			result: {
				items: [
					{
						isin,
						name: "Beispiel ETF",
						quantity: "45",
						valuation: "4509",
						valuation_currency: "EUR",
						quote_mid_price: "100.2",
						quote_timestamp_utc: "2026-09-17T11:59:00Z",
						credential: "must-not-escape",
					},
				],
			},
		});
		expect(parsed).toMatchObject({
			portfolioId: "p",
			positions: [{ quotedValueMinor: 450900 }],
		});
		expect(JSON.stringify(parsed)).not.toContain("must-not-escape");
		expect(() =>
			parseScalableHoldingsPulse({ result: { items: [] } }),
		).toThrow();
		// An unusable row is left out, exactly as the booked snapshot leaves it out.
		expect(
			parseScalableHoldingsPulse({
				account_id: "a",
				portfolio_id: "p",
				result: { items: [{ isin }] },
			}).positions,
		).toEqual([]);
	});
	it("hides an overlay as soon as a newer booked snapshot replaces its baseline", () => {
		expect(
			pulseMatchesConfirmed({ confirmedNetWorthMinor: 5600000 }, 5600000),
		).toBe(true);
		expect(
			pulseMatchesConfirmed({ confirmedNetWorthMinor: 5600000 }, 5590000),
		).toBe(false);
		expect(pulseMatchesConfirmed(null, 5600000)).toBe(false);
	});
	it("keeps the opening value, then accepts upward and downward quotes for only that baseline", () => {
		const up = { baselineMinor: 5_600_000, valueMinor: 5_600_450 };
		const down = { baselineMinor: 5_600_000, valueMinor: 5_599_800 };
		expect(marketDisplayTarget(5_600_000, up, false)).toBe(5_600_000);
		expect(marketDisplayTarget(5_600_000, up, true)).toBe(5_600_450);
		expect(marketDisplayTarget(5_600_000, down, true)).toBe(5_599_800);
		expect(marketDisplayTarget(5_601_000, down, true)).toBe(5_601_000);
	});
});
