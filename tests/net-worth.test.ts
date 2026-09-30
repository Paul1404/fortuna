import { describe, expect, it } from "vitest";
import { FxTable } from "@/domain/fx";
import {
	computeNetWorth,
	effectiveValuationConfidence,
	valueAt,
} from "@/domain/net-worth";

const fx = new FxTable([
	{ date: "2026-01-01", base: "EUR", quote: "USD", rate: 1.25 },
]);

describe("net worth", () => {
	it("is assets minus liabilities with credit cards as liabilities", () => {
		const nw = computeNetWorth({
			date: "2026-09-14",
			baseCurrency: "EUR",
			fx,
			accounts: [
				{
					id: "cur",
					name: "Current",
					type: "current",
					currency: "EUR",
					balanceMinor: 500000,
					includeInNetWorth: true,
				},
				{
					id: "sav",
					name: "Savings",
					type: "savings",
					currency: "EUR",
					balanceMinor: 1000000,
					includeInNetWorth: true,
				},
				{
					id: "cc",
					name: "Card",
					type: "credit_card",
					currency: "EUR",
					balanceMinor: -80000,
					includeInNetWorth: true,
				},
				{
					id: "usd",
					name: "USD cash",
					type: "cash",
					currency: "USD",
					balanceMinor: 12500,
					includeInNetWorth: true,
				},
				{
					id: "hidden",
					name: "Excluded",
					type: "current",
					currency: "EUR",
					balanceMinor: 999999,
					includeInNetWorth: false,
				},
				{
					id: "broker",
					name: "Broker",
					type: "investment",
					currency: "EUR",
					balanceMinor: 20000,
					includeInNetWorth: true,
				},
			],
			positions: [
				{
					id: "p1",
					securityId: "s1",
					name: "ETF",
					quantity: 10,
					price: 100.5,
					currency: "EUR",
					costBasisMinor: 90000,
					accountId: "broker",
				},
				{
					id: "p2",
					securityId: "s2",
					name: "Unpriced",
					quantity: 5,
					price: null,
					currency: "EUR",
					costBasisMinor: 1000,
					accountId: "broker",
				},
			],
			assets: [
				{
					id: "a1",
					name: "Car",
					category: "vehicle",
					currency: "EUR",
					valueMinor: 1500000,
					acquisitionCostMinor: 2000000,
				},
				{
					id: "a2",
					name: "Watch",
					category: "watch",
					currency: "EUR",
					valueMinor: 800000,
					acquisitionCostMinor: 700000,
				},
			],
			receivables: [
				{
					id: "r1",
					name: "Shared trip",
					debtorName: "Friend",
					currency: "EUR",
					balanceMinor: 25_000,
				},
			],
			liabilities: [
				{
					id: "l1",
					name: "Car loan",
					type: "vehicle_finance",
					currency: "EUR",
					balanceMinor: 900000,
					linkedAccountId: null,
				},
				{
					id: "l2",
					name: "Card terms",
					type: "credit_card",
					currency: "EUR",
					balanceMinor: 80000,
					linkedAccountId: "cc",
				},
			],
		});
		// cash: 500000 + 1000000 + 10000 (USD) + 20000 broker cash = 1530000
		expect(nw.cashMinor).toBe(1530000);
		expect(nw.investmentsMinor).toBe(100500);
		expect(nw.physicalMinor).toBe(2300000);
		expect(nw.receivablesMinor).toBe(25_000);
		expect(nw.totalAssetsMinor).toBe(1530000 + 100500 + 2300000 + 25_000);
		expect(nw.creditCardDebtMinor).toBe(80000);
		expect(nw.loanDebtMinor).toBe(900000); // linked credit-card liability not double counted
		expect(nw.totalLiabilitiesMinor).toBe(980000);
		expect(nw.netWorthMinor).toBe(nw.totalAssetsMinor - 980000);
		expect(nw.liquidNetWorthMinor).toBe(1530000 + 100500 - 80000);
		expect(nw.allocation.map((a) => a.key)).toEqual([
			"cash",
			"vehicle",
			"watch",
			"investments",
			"receivables",
		]);
		expect(nw.allocation.reduce((s, a) => s + a.share, 0)).toBeCloseTo(1);
		expect(nw.unconvertedCurrencies).toEqual([]);
	});

	it("reports unconverted currencies instead of summing them", () => {
		const nw = computeNetWorth({
			date: "2026-09-14",
			baseCurrency: "EUR",
			fx,
			accounts: [
				{
					id: "chf",
					name: "CHF",
					type: "current",
					currency: "CHF",
					balanceMinor: 10000,
					includeInNetWorth: true,
				},
			],
			positions: [],
			assets: [],
			liabilities: [],
		});
		expect(nw.netWorthMinor).toBe(0);
		expect(nw.unconvertedCurrencies).toEqual(["CHF"]);
	});

	it("valueAt picks the latest entry at or before a date", () => {
		const series = [
			{ date: "2026-01-01", valueMinor: 1 },
			{ date: "2026-06-01", valueMinor: 2 },
			{ date: "2026-12-01", valueMinor: 3 },
		];
		expect(valueAt(series, "2026-07-15")?.valueMinor).toBe(2);
		expect(valueAt(series, "2025-01-01")).toBeNull();
		expect(valueAt(series, "2026-12-01")?.valueMinor).toBe(3);
	});

	it("counts Scalable holdings and cash even when the valuation is estimated", () => {
		const nw = computeNetWorth({
			date: "2026-09-17",
			baseCurrency: "EUR",
			fx,
			accounts: [
				{
					id: "base",
					name: "Existing assets",
					type: "current",
					currency: "EUR",
					balanceMinor: 5_600_000,
					includeInNetWorth: true,
				},
			],
			positions: [],
			assets: [],
			liabilities: [],
			providerAccounts: [
				{
					id: "scalable",
					provider: "Scalable Capital",
					method: "cli",
					linkedAccountId: null,
					currency: "EUR",
					cashBalanceMinor: 6_900,
					cashValuationAt: "2026-09-15T12:00:00Z",
					portfolioValueMinor: null,
					portfolioValuationAt: null,
					holdings: [
						{
							id: "holding",
							name: "ETF",
							isin: "IE00B4L5Y983",
							valueMinor: 450_000,
							currency: "EUR",
							valuationAt: "2026-09-15T12:00:00Z",
							confidence: "estimated",
						},
					],
				},
			],
		});
		expect(nw.netWorthMinor).toBe(6_056_900);
		expect(nw.investmentsMinor).toBe(450_000);
		expect(nw.cashMinor).toBe(5_606_900);
		expect(nw.providerBreakdown[0]).toMatchObject({
			totalMinor: 456_900,
			confidence: "estimated",
		});
	});

	it("replaces a linked manual broker account and its positions instead of double counting", () => {
		const nw = computeNetWorth({
			date: "2026-09-17",
			baseCurrency: "EUR",
			fx,
			accounts: [
				{
					id: "manual",
					name: "Scalable",
					type: "investment",
					currency: "EUR",
					balanceMinor: 6_900,
					includeInNetWorth: true,
				},
			],
			positions: [
				{
					id: "old",
					securityId: "sec",
					name: "ETF",
					quantity: 45,
					price: 100,
					currency: "EUR",
					costBasisMinor: 400_000,
					accountId: "manual",
				},
			],
			assets: [],
			liabilities: [],
			providerAccounts: [
				{
					id: "source",
					provider: "Scalable Capital",
					method: "cli",
					linkedAccountId: "manual",
					currency: "EUR",
					cashBalanceMinor: 6_900,
					cashValuationAt: "2026-09-17T08:00:00Z",
					portfolioValueMinor: 450_000,
					portfolioValuationAt: "2026-09-17T08:00:00Z",
					holdings: [
						{
							id: "live",
							name: "ETF",
							isin: "IE00B4L5Y983",
							valueMinor: 450_000,
							currency: "EUR",
							valuationAt: "2026-09-17T08:00:00Z",
							confidence: "provider_reported",
						},
					],
				},
			],
		});
		expect(nw.netWorthMinor).toBe(456_900);
		expect(nw.positionValues).toEqual([]);
	});

	it("keeps stale and unvalued holdings visible without inventing money", () => {
		expect(
			effectiveValuationConfidence(
				"estimated",
				"2026-06-01T00:00:00Z",
				"2026-09-17",
			),
		).toBe("stale");
		const nw = computeNetWorth({
			date: "2026-09-17",
			baseCurrency: "EUR",
			fx,
			accounts: [],
			positions: [],
			assets: [],
			liabilities: [],
			providerAccounts: [
				{
					id: "source",
					provider: "Scalable Capital",
					method: "cli",
					linkedAccountId: null,
					currency: "EUR",
					cashBalanceMinor: null,
					cashValuationAt: null,
					portfolioValueMinor: null,
					portfolioValuationAt: null,
					holdings: [
						{
							id: "stale",
							name: "Altes Depot",
							isin: "DE000A0F5UH1",
							valueMinor: 10_000,
							currency: "EUR",
							valuationAt: "2026-06-01T00:00:00Z",
							confidence: "estimated",
						},
						{
							id: "unpriced",
							name: "ETF",
							isin: "IE00B4L5Y983",
							valueMinor: null,
							currency: "EUR",
							valuationAt: null,
							confidence: "unavailable",
						},
					],
				},
			],
		});
		expect(nw.netWorthMinor).toBe(10_000);
		expect(nw.providerBreakdown[0].unvaluedHoldings).toBe(1);
		expect(nw.providerBreakdown[0].confidence).toBe("stale");
	});

	it("counts a linked liability when its account is missing or excluded", () => {
		const base = {
			date: "2026-09-14",
			baseCurrency: "EUR",
			fx,
			assets: [],
			positions: [],
			liabilities: [
				{
					id: "l1",
					name: "Kartenrahmen",
					type: "credit_card" as const,
					currency: "EUR",
					balanceMinor: 80_000,
					linkedAccountId: "cc",
				},
			],
		};
		// The linked account exists and counts, so the liability must not double count.
		const counted = computeNetWorth({
			...base,
			accounts: [
				{
					id: "cc",
					name: "Karte",
					type: "credit_card",
					currency: "EUR",
					balanceMinor: -80_000,
					includeInNetWorth: true,
				},
			],
		});
		expect(counted.totalLiabilitiesMinor).toBe(80_000);

		// Excluded from net worth: nothing else carries the debt.
		const excluded = computeNetWorth({
			...base,
			accounts: [
				{
					id: "cc",
					name: "Karte",
					type: "credit_card",
					currency: "EUR",
					balanceMinor: -80_000,
					includeInNetWorth: false,
				},
			],
		});
		expect(excluded.totalLiabilitiesMinor).toBe(80_000);

		// The account does not exist in this snapshot at all.
		const missing = computeNetWorth({ ...base, accounts: [] });
		expect(missing.totalLiabilitiesMinor).toBe(80_000);
		expect(missing.netWorthMinor).toBe(-80_000);
	});
});
