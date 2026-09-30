import { describe, expect, it } from "vitest";
import { buildForecast, irregularDailyNet } from "@/domain/forecast";

describe("forecast", () => {
	it("layers scheduled, recurring and irregular projections separately", () => {
		const result = buildForecast({
			startDate: "2026-09-14",
			horizonDays: 30,
			openingBalanceMinor: 100000,
			recurring: [
				{
					id: "rent",
					name: "Rent",
					amountMinor: -90000,
					frequency: "monthly",
					intervalDays: 30,
					nextExpected: "2026-10-01",
					isActive: true,
				},
				{
					id: "salary",
					name: "Salary",
					amountMinor: 300000,
					frequency: "monthly",
					intervalDays: 30,
					nextExpected: "2026-09-28",
					isActive: true,
				},
				{
					id: "old",
					name: "Cancelled",
					amountMinor: -5000,
					frequency: "monthly",
					intervalDays: 30,
					nextExpected: "2026-09-20",
					isActive: false,
				},
			],
			scheduled: [
				{ id: "s1", name: "Tax", date: "2026-09-20", amountMinor: -20000 },
			],
			irregularDailyNetMinor: -1000,
			irregularMonthlyStdMinor: 30000,
		});
		expect(result.events.map((e) => [e.date, e.name])).toEqual([
			["2026-09-20", "Tax"],
			["2026-09-28", "Salary"],
			["2026-10-01", "Rent"],
		]);
		const last = result.points[result.points.length - 1];
		expect(last.scheduledOnlyMinor).toBe(100000 - 20000);
		expect(last.withRecurringMinor).toBe(100000 - 20000 + 300000 - 90000);
		expect(last.projectedMinor).toBe(
			100000 - 20000 + 300000 - 90000 - 30 * 1000,
		);
		expect(last.lowMinor).toBeLessThan(last.projectedMinor);
		expect(last.highMinor).toBeGreaterThan(last.projectedMinor);
		expect(result.lowestPoint?.date).toBe("2026-09-27");
		expect(result.scheduledNetMinor).toBe(-20000);
		expect(result.recurringNetMinor).toBe(210000);
	});

	it("places an overdue recurring item at the start of the horizon", () => {
		const result = buildForecast({
			startDate: "2026-09-14",
			horizonDays: 10,
			openingBalanceMinor: 0,
			recurring: [
				{
					id: "r",
					name: "Gym",
					amountMinor: -3000,
					frequency: "monthly",
					intervalDays: 30,
					nextExpected: "2026-09-10",
					isActive: true,
				},
			],
			scheduled: [],
			irregularDailyNetMinor: 0,
		});
		expect(result.events[0]?.date).toBe("2026-09-14");
		expect(result.points[0]?.projectedMinor).toBe(-3000);
	});

	it("derives irregular daily net from history without recurring or transfer rows", () => {
		const stats = irregularDailyNet(
			[
				{ bookingDate: "2026-08-01", amountMinor: -3100 },
				{
					bookingDate: "2026-08-15",
					amountMinor: -50000,
					recurringPaymentId: "r",
				},
				{
					bookingDate: "2026-08-20",
					amountMinor: -10000,
					transferGroupId: "t",
				},
			],
			"2026-08-01",
			"2026-08-31",
		);
		expect(stats.dailyNetMinor).toBeCloseTo(-100);
	});

	it("leaves money moved to the broker or a card out of the spending baseline", () => {
		const stats = irregularDailyNet(
			[
				{ bookingDate: "2026-08-01", amountMinor: -3100 },
				{
					bookingDate: "2026-08-17",
					amountMinor: -456849,
					categoryKind: "transfer",
				},
				{ bookingDate: "2026-08-20", amountMinor: 0, categoryKind: "expense" },
			],
			"2026-08-01",
			"2026-08-31",
		);
		expect(stats.dailyNetMinor).toBeCloseTo(-100);
	});

	it("averages over the days that have data, not the whole window", () => {
		// A bank connected on 01.09 reports from 03.06; the window reaches back
		// to March. Six months of divisor would shrink the rate by half.
		const stats = irregularDailyNet(
			[
				{ bookingDate: "2026-06-03", amountMinor: 0 },
				{ bookingDate: "2026-08-31", amountMinor: -9000 },
			],
			"2026-03-01",
			"2026-08-31",
		);
		expect(stats.dailyNetMinor).toBeCloseTo(-100);
	});

	it("does not count a pending booking and its recurring occurrence twice", () => {
		const result = buildForecast({
			startDate: "2026-09-18",
			horizonDays: 30,
			openingBalanceMinor: 200_000,
			recurring: [
				{
					id: "rent",
					name: "Miete",
					amountMinor: -120_000,
					frequency: "monthly",
					intervalDays: 30,
					nextExpected: "2026-09-20",
					isActive: true,
				},
			],
			// The bank already shows this month's rent as pending.
			scheduled: [
				{
					id: "p1",
					name: "Miete",
					date: "2026-09-20",
					amountMinor: -120_000,
					recurringPaymentId: "rent",
				},
			],
			irregularDailyNetMinor: 0,
		});
		expect(result.endBalanceMinor).toBe(80_000);
		expect(result.events.filter((e) => e.date === "2026-09-20")).toHaveLength(
			1,
		);
		expect(result.recurringNetMinor).toBe(0);
		expect(result.scheduledNetMinor).toBe(-120_000);
	});

	it("keeps an overdue item's cadence anchored on its own day", () => {
		const result = buildForecast({
			startDate: "2026-09-18",
			horizonDays: 100,
			openingBalanceMinor: 500_000,
			recurring: [
				{
					id: "rent",
					name: "Miete",
					amountMinor: -100_000,
					frequency: "monthly",
					intervalDays: 30,
					// Missed: still due, but the cadence belongs to the 1st.
					nextExpected: "2026-09-01",
					isActive: true,
				},
			],
			scheduled: [],
			irregularDailyNetMinor: 0,
		});
		expect(result.events.map((e) => e.date)).toEqual([
			"2026-09-18",
			"2026-10-01",
			"2026-11-01",
			"2026-12-01",
		]);
	});

	it("projects a month-end item on the month's last day", () => {
		const result = buildForecast({
			startDate: "2026-01-01",
			horizonDays: 120,
			openingBalanceMinor: 0,
			recurring: [
				{
					id: "salary",
					name: "Gehalt",
					amountMinor: 300_000,
					frequency: "monthly",
					intervalDays: 30,
					nextExpected: "2026-01-31",
					isActive: true,
				},
			],
			scheduled: [],
			irregularDailyNetMinor: 0,
		});
		expect(result.events.map((e) => e.date)).toEqual([
			"2026-01-31",
			"2026-02-28",
			"2026-03-31",
			"2026-04-30",
		]);
	});

	it("charges an overdue item once when its cadence lands on day one", () => {
		// Overdue by exactly one month: the catch-up and the cadence would both
		// fall on the first day of the horizon.
		const result = buildForecast({
			startDate: "2026-09-18",
			horizonDays: 40,
			openingBalanceMinor: 0,
			recurring: [
				{
					id: "rent",
					name: "Miete",
					amountMinor: -90_000,
					frequency: "monthly",
					intervalDays: 30,
					nextExpected: "2026-08-18",
					isActive: true,
				},
			],
			scheduled: [],
			irregularDailyNetMinor: 0,
		});
		expect(
			result.events.filter((event) => event.date === "2026-09-18"),
		).toHaveLength(1);
		expect(result.recurringNetMinor).toBe(-180_000);
		expect(result.events.map((event) => event.date)).toEqual([
			"2026-09-18",
			"2026-10-18",
		]);
	});

	it("counts a month-end payment from its typical day, not the clamped date", () => {
		// Rent due on the 31st whose next date is 30.06.: July and August must
		// be the 31st again, not stay a day early for good.
		const result = buildForecast({
			startDate: "2026-06-01",
			horizonDays: 92,
			openingBalanceMinor: 0,
			recurring: [
				{
					id: "rent",
					name: "Miete",
					amountMinor: -90000,
					frequency: "monthly",
					intervalDays: 30,
					nextExpected: "2026-06-30",
					typicalDay: 31,
					isActive: true,
				},
			],
			scheduled: [],
			irregularDailyNetMinor: 0,
		});
		expect(result.events.map((e) => e.date)).toEqual([
			"2026-06-30",
			"2026-07-31",
			"2026-08-31",
		]);
	});

	it("does not move a payment whose own day is the month's last", () => {
		const result = buildForecast({
			startDate: "2026-06-01",
			horizonDays: 62,
			openingBalanceMinor: 0,
			recurring: [
				{
					id: "gym",
					name: "Studio",
					amountMinor: -3000,
					frequency: "monthly",
					intervalDays: 30,
					nextExpected: "2026-06-15",
					typicalDay: 31,
					isActive: true,
				},
			],
			scheduled: [],
			irregularDailyNetMinor: 0,
		});
		expect(result.events.map((e) => e.date)).toEqual([
			"2026-06-15",
			"2026-07-15",
		]);
	});
});
