import { describe, expect, it } from "vitest";
import {
	assetRevaluationMinor,
	growthBreakdown,
	growthWindow,
	netBrokerDepositsMinor,
	reservePot,
	reservePotText,
	savingsStreak,
} from "@/domain/progress";

describe("growthWindow", () => {
	it("compares the end of the day before the period with today", () => {
		expect(growthWindow("month", "2026-09-28", "2026-06-01")).toEqual({
			startDate: "2026-08-31",
			endDate: "2026-09-28",
			cashflowFrom: "2026-09-01",
			clamped: false,
		});
		expect(growthWindow("last_month", "2026-09-28", "2026-06-01")).toEqual({
			startDate: "2026-07-31",
			endDate: "2026-08-31",
			cashflowFrom: "2026-08-01",
			clamped: false,
		});
	});

	it("starts where the data starts instead of at an empty balance sheet", () => {
		expect(growthWindow("year", "2026-09-28", "2026-06-03")).toEqual({
			startDate: "2026-06-03",
			endDate: "2026-09-28",
			cashflowFrom: "2026-06-04",
			clamped: true,
		});
	});

	it("has nothing to compare without data or before it begins", () => {
		expect(growthWindow("year", "2026-09-28", null)).toBeNull();
		expect(growthWindow("last_month", "2026-09-28", "2026-09-02")).toBeNull();
	});
});

describe("growthBreakdown", () => {
	it("splits the change into saving, market and the rest", () => {
		const result = growthBreakdown({
			startNetWorthMinor: 1_000_000,
			endNetWorthMinor: 1_150_000,
			savingMinor: 120_000,
			revaluationMinor: 20_000,
			depot: null,
		});
		expect(result).toEqual({
			totalMinor: 150_000,
			savingMinor: 120_000,
			marketMinor: 20_000,
			otherMinor: 10_000,
			depot: "none",
		});
	});

	it("counts a bank → depot transfer as neither saving nor market", () => {
		// 1 000 € left the bank (a transfer: not in saving) and arrived in a
		// depot that did not exist before; prices then added 30 €.
		const result = growthBreakdown({
			startNetWorthMinor: 500_000,
			endNetWorthMinor: 400_000,
			savingMinor: 0,
			revaluationMinor: 0,
			depot: { startMinor: 0, endMinor: 103_000, netDepositsMinor: 100_000 },
		});
		expect(result.totalMinor).toBe(3_000);
		expect(result.savingMinor).toBe(0);
		expect(result.marketMinor).toBe(3_000);
		expect(result.otherMinor).toBe(0);
		expect(result.depot).toBe("included");
	});

	it("leaves depot prices out rather than guessing a start value", () => {
		const result = growthBreakdown({
			startNetWorthMinor: 500_000,
			endNetWorthMinor: 400_000,
			savingMinor: 50_000,
			revaluationMinor: 0,
			depot: { startMinor: null, endMinor: 900_000, netDepositsMinor: 100_000 },
		});
		// The deposit is still the owner's money; the depot's value is not
		// read as growth.
		expect(result.totalMinor).toBe(0);
		expect(result.marketMinor).toBe(0);
		expect(result.otherMinor).toBe(-50_000);
		expect(result.depot).toBe("excluded");
	});

	it("never forces the remainder to zero", () => {
		const result = growthBreakdown({
			startNetWorthMinor: 0,
			endNetWorthMinor: -10_000,
			savingMinor: 40_000,
			revaluationMinor: 0,
			depot: null,
		});
		expect(result.otherMinor).toBe(-50_000);
		expect(result.savingMinor + result.marketMinor + result.otherMinor).toBe(
			result.totalMinor,
		);
	});
});

describe("assetRevaluationMinor", () => {
	it("counts value changes, not the first recording or a sale", () => {
		const total = assetRevaluationMinor(
			[
				// Held throughout: 10 000 → 12 000.
				{
					valuations: [
						{ date: "2026-01-10", valueMinor: 1_000_000 },
						{ date: "2026-08-15", valueMinor: 1_200_000 },
					],
					countedAtStart: true,
					countedAtEnd: true,
					disposedAt: null,
				},
				// Bought inside the window at 500, now worth 450.
				{
					valuations: [
						{ date: "2026-09-10", valueMinor: 50_000 },
						{ date: "2026-09-20", valueMinor: 45_000 },
					],
					countedAtStart: false,
					countedAtEnd: true,
					disposedAt: null,
				},
				// Sold inside the window after rising 100.
				{
					valuations: [
						{ date: "2026-01-01", valueMinor: 30_000 },
						{ date: "2026-09-05", valueMinor: 40_000 },
					],
					countedAtStart: true,
					countedAtEnd: false,
					disposedAt: "2026-09-12",
				},
			],
			"2026-07-31",
			"2026-09-28",
		);
		expect(total).toBe(200_000 - 5_000 + 10_000);
	});
});

describe("netBrokerDepositsMinor", () => {
	it("adds deposits, subtracts withdrawals, ignores the rest", () => {
		expect(
			netBrokerDepositsMinor(
				[
					{
						date: "2026-09-01",
						kind: "deposit",
						status: "SETTLED",
						amountMinor: 100_000,
					},
					{
						date: "2026-09-03",
						kind: "withdrawal",
						status: "SETTLED",
						amountMinor: -20_000,
					},
					{
						date: "2026-09-04",
						kind: "withdrawal",
						status: "SETTLED",
						amountMinor: 5_000,
					},
					{
						date: "2026-09-05",
						kind: "buy",
						status: "SETTLED",
						amountMinor: -80_000,
					},
					{
						date: "2026-09-06",
						kind: "deposit",
						status: "CANCELLED",
						amountMinor: 99_000,
					},
					{
						date: "2026-08-31",
						kind: "deposit",
						status: "SETTLED",
						amountMinor: 7_000,
					},
				],
				"2026-09-01",
				"2026-09-28",
			),
		).toBe(75_000);
	});
});

describe("savingsStreak", () => {
	const month = (m: string, netMinor: number) => ({ month: m, netMinor });

	it("counts full months back from the last one, never the running month", () => {
		expect(
			savingsStreak({
				months: [
					month("2026-05", 10_000),
					month("2026-06", -5_000),
					month("2026-07", 20_000),
					month("2026-08", 30_000),
					month("2026-09", -90_000),
				],
				firstBookingDate: "2026-05-01",
				today: "2026-09-28",
			}),
		).toEqual({ months: 2, since: "2026-07", fullMonths: 4 });
	});

	it("does not count the partial first month", () => {
		expect(
			savingsStreak({
				months: [
					month("2026-06", 50_000),
					month("2026-07", 1),
					month("2026-08", 2),
				],
				firstBookingDate: "2026-06-12",
				today: "2026-09-01",
			}),
		).toEqual({ months: 2, since: "2026-07", fullMonths: 2 });
	});

	it("is zero when the last full month ended at or below zero", () => {
		expect(
			savingsStreak({
				months: [month("2026-07", 10_000), month("2026-08", 0)],
				firstBookingDate: "2026-07-01",
				today: "2026-09-10",
			}).months,
		).toBe(0);
	});

	it("has nothing to count before a full month exists", () => {
		expect(
			savingsStreak({
				months: [month("2026-09", 80_000)],
				firstBookingDate: "2026-09-03",
				today: "2026-09-28",
			}),
		).toEqual({ months: 0, since: null, fullMonths: 0 });
		expect(
			savingsStreak({
				months: [],
				firstBookingDate: null,
				today: "2026-09-28",
			}),
		).toEqual({ months: 0, since: null, fullMonths: 0 });
	});
});

const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");

describe("reservePot", () => {
	const reserve = { reserveMinor: 491_700, note: "3 Monatsausgaben." };

	it("says full when the bank cash covers the reserve", () => {
		const pot = reservePot(812_000, reserve);
		expect(pot?.full).toBe(true);
		expect(pot?.percent).toBe(100);
		expect(plain(reservePotText(pot as NonNullable<typeof pot>, "EUR"))).toBe(
			"Reserve: 4.917,00 € von 4.917,00 € — voll",
		);
	});

	it("shows how far a partial pot is, rounded down", () => {
		const pot = reservePot(320_000, reserve);
		expect(pot?.full).toBe(false);
		expect(pot?.percent).toBe(65);
		expect(plain(reservePotText(pot as NonNullable<typeof pot>, "EUR"))).toBe(
			"Reserve: 3.200,00 € von 4.917,00 € — 65 %",
		);
		// One cent short is never "100 %".
		expect(reservePot(491_699, reserve)?.percent).toBe(99);
		expect(reservePot(-5_000, reserve)?.percent).toBe(0);
	});

	it("has no pot without a reserve", () => {
		expect(reservePot(100_000, { reserveMinor: null, note: "" })).toBeNull();
		expect(reservePot(100_000, { reserveMinor: 0, note: "" })).toBeNull();
	});
});
