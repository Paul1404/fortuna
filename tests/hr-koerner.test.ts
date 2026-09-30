import { describe, expect, it } from "vitest";
import {
	CREEP_MIN_FULL_MONTHS,
	detectFinancialObservations,
	detectLifestyleCreep,
	estimateGoalDelayDays,
	estimateMonthsToGoal,
	type FixedCostTrendMonth,
	type ReviewInput,
} from "@/domain/hr-koerner";

/** Consecutive full months ending with `last`, fixed costs and income given per month. */
function trend(
	last: string,
	rows: [fixedCostsMinor: number, incomeMinor: number][],
): FixedCostTrendMonth[] {
	const [year, month] = last.split("-").map(Number);
	return rows.map(([fixedCostsMinor, incomeMinor], index) => {
		const offset = rows.length - 1 - index;
		const total = year * 12 + (month - 1) - offset;
		return {
			month: `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`,
			fixedCostsMinor,
			incomeMinor,
		};
	});
}

const base: ReviewInput = {
	today: "2026-09-17",
	baseCurrency: "EUR",
	cashMinor: 1_200_000,
	reserveMinor: 1_000_000,
	profile: {
		largePurchaseThresholdMinor: 5000,
		unusualSpendMultiplierBps: 25000,
		ignoredCategoryIds: [],
	},
	transactions: [],
	recurring: [],
	staleValuations: [],
};

describe("Hr. Körner deterministic review", () => {
	it("warns only when a configured liquid reserve is breached", () => {
		const result = detectFinancialObservations({ ...base, cashMinor: 900_000 });
		expect(result).toMatchObject([
			{
				type: "liquidity_below_floor",
				impactMinor: 100_000,
				severity: "urgent",
			},
		]);
		expect(
			detectFinancialObservations({
				...base,
				reserveMinor: null,
				cashMinor: 0,
			}),
		).toEqual([]);
	});

	it("flags an outlier from actual merchant history without claiming fraud or product ownership", () => {
		const transactions = ["1", "2", "3"].map((id, index) => ({
			id,
			bookingDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
			amountMinor: -4000,
			currency: "EUR",
			merchantName: "Schuhhaus",
			categoryId: "shoes",
			transferGroupId: null,
			status: "booked",
		}));
		const recent = {
			...transactions[0],
			id: "new",
			bookingDate: "2026-09-16",
			amountMinor: -18900,
		};
		const result = detectFinancialObservations({
			...base,
			transactions: [...transactions, recent],
		});
		expect(result[0]).toMatchObject({
			type: "unusual_spend",
			key: "unusual_spend:new",
			confidence: "medium",
		});
		expect(result[0].evidence).toMatchObject({
			spentMinor: 18900,
			merchantMedianMinor: 4000,
			priorCount: 3,
		});
		expect(`${result[0].title} ${result[0].explanation}`).not.toMatch(
			/betrug|besitzen|fraud/i,
		);
		expect(
			detectFinancialObservations({
				...base,
				transactions: [...transactions, recent],
				profile: { ...base.profile, ignoredCategoryIds: ["shoes"] },
			}),
		).toEqual([]);
	});

	it("ignores a purchase threshold entered in the previous base currency", () => {
		const transactions = ["1", "2", "3"].map((id, index) => ({
			id,
			bookingDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
			amountMinor: -4000,
			currency: "USD",
			merchantName: "Schuhhaus",
			categoryId: "shoes",
			transferGroupId: null,
			status: "booked",
		}));
		const recent = {
			...transactions[0],
			id: "new",
			bookingDate: "2026-09-16",
			amountMinor: -18900,
		};
		// 500 € was the owner's threshold; the base is now USD. The EUR figure
		// must not silence a 189 $ outlier as if it were 500 $.
		const findings = detectFinancialObservations({
			...base,
			baseCurrency: "USD",
			profile: {
				...base.profile,
				currency: "EUR",
				largePurchaseThresholdMinor: 50_000,
			},
			transactions: [...transactions, recent],
		});
		expect(findings.map((row) => row.key)).toEqual(["unusual_spend:new"]);
	});

	it("annualizes small subscriptions but does not assert non-usage or savings", () => {
		const recurring = ["a", "b", "c"].map((id) => ({
			id,
			name: id,
			direction: "outflow",
			currency: "EUR",
			isSubscription: true,
			// Outflows are stored negative, exactly as detection writes them.
			monthlyEquivalentMinor: -1000,
		}));
		const result = detectFinancialObservations({ ...base, recurring });
		expect(result[0]).toMatchObject({
			type: "repeated_small_leak",
			impactMinor: 36000,
		});
		expect(result[0].evidence).toMatchObject({
			monthlyMinor: 3000,
			annualMinor: 36000,
		});
		expect(result[0].explanation).toContain("nicht erkennbar");
		expect(
			detectFinancialObservations({
				...base,
				recurring: recurring.map((row) => ({ ...row, currency: "USD" })),
			}),
		).toEqual([]);
	});

	it("warns of a scheduled payment only when it threatens the reserve", () => {
		const recurring = [
			{
				id: "rent",
				name: "Miete",
				direction: "outflow",
				currency: "EUR",
				isSubscription: false,
				monthlyEquivalentMinor: -100_000,
				expectedAmountMinor: -300_000,
				nextExpected: "2026-09-20",
			},
		];
		const result = detectFinancialObservations({ ...base, recurring });
		expect(result[0]).toMatchObject({
			type: "upcoming_large_payment",
			severity: "review",
			impactMinor: 100_000,
			confidence: "medium",
		});
		expect(
			detectFinancialObservations({ ...base, cashMinor: 1_500_000, recurring }),
		).toEqual([]);
	});

	it("makes stale or missing valuations visible without inventing a current price", () => {
		const result = detectFinancialObservations({
			...base,
			staleValuations: [
				{ id: "a", kind: "asset", name: "Uhr", ageDays: 45 },
				{ id: "b", kind: "security", name: "ETF", ageDays: null },
			],
		});
		expect(result).toHaveLength(2);
		expect(result.every((item) => item.impactMinor === null)).toBe(true);
		expect(
			detectFinancialObservations({
				...base,
				profile: { ...base.profile, alertSensitivity: "detailed" },
				staleValuations: [
					{ id: "new", kind: "asset", name: "Uhr", ageDays: 20 },
				],
			}),
		).toHaveLength(1);
	});

	it("estimates goal delay only from a stated positive monthly saving rate", () => {
		expect(estimateGoalDelayDays(180_000, 300_000)).toBe(19);
		expect(estimateGoalDelayDays(180_000, null)).toBeNull();
		expect(estimateGoalDelayDays(180_000, 0)).toBeNull();
	});
	it("calculates goal horizon only from a stated positive savings rate", () => {
		expect(estimateMonthsToGoal(10_000_000, 5_600_000, 300_000)).toBe(15);
		expect(estimateMonthsToGoal(10_000_000, 10_000_000, null)).toBe(0);
		expect(estimateMonthsToGoal(10_000_000, 5_600_000, null)).toBeNull();
	});
});

describe("price increases", () => {
	const telekom = {
		id: "r1",
		name: "Telekom Deutschland GmbH · Mobilfunk",
		direction: "outflow",
		currency: "EUR",
		isSubscription: false,
		monthlyEquivalentMinor: -5230,
		expectedAmountMinor: -5230,
		previousAmountMinor: -4995,
		priceChangedAt: "2026-07-27",
	};

	it("reports what it costs now, what it cost, and the year's difference", () => {
		const [finding] = detectFinancialObservations({
			...base,
			recurring: [telekom],
		}).filter((row) => row.type === "recurring_price_increase");
		expect(finding).toMatchObject({
			type: "recurring_price_increase",
			severity: "notable",
			// Twelve times 2,35 €.
			impactMinor: 2820,
			actionable: true,
		});
		expect(finding.title).toContain("teurer geworden");
		expect(finding.explanation).toContain("52,30");
		expect(finding.explanation).toContain("49,95");
	});

	it("keys on the date, so the same rise is never reported twice", () => {
		const key = () =>
			detectFinancialObservations({ ...base, recurring: [telekom] }).find(
				(row) => row.type === "recurring_price_increase",
			)?.key;
		expect(key()).toBe(key());
		expect(key()).toContain("2026-07-27");
	});

	it("says nothing about a payment that got cheaper or never moved", () => {
		const quiet = (over: Record<string, unknown>) =>
			detectFinancialObservations({
				...base,
				recurring: [{ ...telekom, ...over }],
			}).filter((row) => row.type === "recurring_price_increase");
		// Cheaper is not a finding.
		expect(quiet({ previousAmountMinor: -5900 })).toEqual([]);
		expect(quiet({ previousAmountMinor: null })).toEqual([]);
		expect(quiet({ priceChangedAt: null })).toEqual([]);
		// A yearly payment in another currency cannot be compared to the base.
		expect(quiet({ currency: "CHF" })).toEqual([]);
	});

	it("does not call a raise in income a price increase", () => {
		const salary = {
			...telekom,
			id: "salary",
			name: "Gehalt",
			direction: "inflow",
			monthlyEquivalentMinor: 320_000,
			expectedAmountMinor: 320_000,
			previousAmountMinor: 300_000,
		};
		expect(
			detectFinancialObservations({ ...base, recurring: [salary] }).filter(
				(row) => row.type === "recurring_price_increase",
			),
		).toEqual([]);
	});

	it("names the payment's own currency", () => {
		const [finding] = detectFinancialObservations({
			...base,
			baseCurrency: "CHF",
			profile: { ...base.profile, currency: "CHF" },
			recurring: [{ ...telekom, currency: "CHF" }],
		}).filter((row) => row.type === "recurring_price_increase");
		expect(finding.explanation).toContain("52,30 CHF");
		expect(finding.explanation).not.toContain("€");
	});

	it("treats a large rise as worth a closer look", () => {
		const [finding] = detectFinancialObservations({
			...base,
			recurring: [
				{
					...telekom,
					monthlyEquivalentMinor: -20_000,
					expectedAmountMinor: -20_000,
					previousAmountMinor: -10_000,
				},
			],
		}).filter((row) => row.type === "recurring_price_increase");
		expect(finding.severity).toBe("review");
	});
});

describe("lifestyle creep", () => {
	// Q1 at 1.500 € fixed, Q2 at 1.800 € fixed (+20 %), income flat at 4.000 €.
	const creeping = trend("2026-08", [
		[150_000, 400_000],
		[150_000, 400_000],
		[150_000, 400_000],
		[180_000, 400_000],
		[180_000, 400_000],
		[180_000, 400_000],
		[180_000, 400_000],
		[180_000, 400_000],
	]);

	it("reports fixed costs growing faster than income, once per quarter", () => {
		const finding = detectLifestyleCreep(creeping, "EUR");
		expect(finding).toMatchObject({
			// The latest full quarter is Q2: July and August are not a quarter yet.
			key: "lifestyle_creep:2026-Q2",
			type: "lifestyle_creep",
			severity: "info",
			impactMinor: 30_000,
			periodStart: "2026-01-01",
			periodEnd: "2026-06-30",
			evidence: {
				fixedCostsBeforeMinor: 150_000,
				fixedCostsNowMinor: 180_000,
				fixedGrowthBps: 2_000,
				incomeGrowthBps: 0,
				comparedWith: "quarter",
			},
		});
		expect(finding?.explanation).toContain("2. Quartal 2026");
		expect(finding?.explanation).toContain("+20 %");
		// An observation, not a verdict.
		expect(finding?.explanation).toContain("kein Urteil");
		// It runs through the engine like every other finding.
		expect(
			detectFinancialObservations({ ...base, fixedCostTrend: creeping }).map(
				(row) => row.key,
			),
		).toContain("lifestyle_creep:2026-Q2");
	});

	it("never fires on less than six full months of data", () => {
		// The owner's history today covers fewer than six full months, so the
		// same rise on five months must stay silent.
		expect(CREEP_MIN_FULL_MONTHS).toBe(6);
		const five = creeping.slice(-5);
		expect(detectLifestyleCreep(five, "EUR")).toBeNull();
		expect(
			detectFinancialObservations({ ...base, fixedCostTrend: five }),
		).toEqual([]);
	});

	it("stays silent when income grew just as much", () => {
		const both = creeping.map((row, index) => ({
			...row,
			incomeMinor: index >= 3 ? 480_000 : 400_000,
		}));
		expect(detectLifestyleCreep(both, "EUR")).toBeNull();
	});

	it("ignores a rise too small to mention", () => {
		const small = trend("2026-06", [
			[20_000, 400_000],
			[20_000, 400_000],
			[20_000, 400_000],
			[22_000, 400_000],
			[22_000, 400_000],
			[22_000, 400_000],
		]);
		// +10 %, but only 20 € a month.
		expect(detectLifestyleCreep(small, "EUR")).toBeNull();
	});

	it("compares with the same quarter a year earlier once history allows", () => {
		const rows: [number, number][] = Array.from({ length: 15 }, (_, index) =>
			// Fixed costs 1.500 € until a year ago, then 1.700 €, income +2 %.
			index < 3 ? [150_000, 400_000] : [170_000, 408_000],
		);
		const finding = detectLifestyleCreep(trend("2026-06", rows), "EUR");
		expect(finding).toMatchObject({
			key: "lifestyle_creep:2026-Q2",
			evidence: { comparedWith: "year", fixedGrowthBps: 1_333 },
		});
		expect(finding?.explanation).toContain("ein Jahr zuvor");
	});
});
