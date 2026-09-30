import { describe, expect, it } from "vitest";
import { monthlyExpenseBasis, requiredReserve } from "@/domain/reserve";

const months = (rows: [string, number][]) =>
	rows.map(([month, expenseMinor]) => ({ month, expenseMinor }));

describe("reserve", () => {
	it("averages full months only, never the running or the first partial one", () => {
		const basis = monthlyExpenseBasis({
			months: months([
				["2026-05", 50_000],
				["2026-06", 200_000],
				["2026-07", 220_000],
				["2026-08", 240_000],
				["2026-09", 90_000],
			]),
			firstBookingDate: "2026-05-17",
			today: "2026-09-27",
			recurringMonthlyMinor: 0,
		});
		expect(basis).toEqual({
			monthlyMinor: 220_000,
			source: "history",
			fullMonths: 3,
		});
	});

	it("does not divide two weeks of bookings by a month", () => {
		const basis = monthlyExpenseBasis({
			months: months([
				["2026-08", 0],
				["2026-09", 180_000],
			]),
			firstBookingDate: "2026-09-12",
			today: "2026-09-27",
			recurringMonthlyMinor: 95_000,
		});
		expect(basis).toEqual({
			monthlyMinor: 95_000,
			source: "recurring",
			fullMonths: 0,
		});
		const reserve = requiredReserve({
			basis,
			reserveMonths: 3,
			minimumReserveMinor: null,
			currency: "EUR",
		});
		expect(reserve.reserveMinor).toBe(285_000);
		expect(reserve.note).toContain("feste Zahlungen");
		expect(reserve.note).toContain("0 von 3 vollen Monaten");
	});

	it("never sets the reserve below spending already seen in full months", () => {
		// Bookings from mid-June: July and August are full, September runs.
		// The fixed payments alone come to a fraction of what those two
		// months actually cost, and a reserve built on them covered less
		// than one real month.
		const basis = monthlyExpenseBasis({
			months: months([
				["2026-06", 7_000],
				["2026-07", 130_000],
				["2026-08", 40_000],
				["2026-09", 12_000],
			]),
			firstBookingDate: "2026-06-19",
			today: "2026-09-28",
			recurringMonthlyMinor: 7_500,
		});
		expect(basis).toEqual({
			monthlyMinor: 85_000,
			source: "partial",
			fullMonths: 2,
		});
		const reserve = requiredReserve({
			basis,
			reserveMonths: 6,
			minimumReserveMinor: null,
			currency: "EUR",
		});
		expect(reserve.reserveMinor).toBe(510_000);
		expect(reserve.note).toContain("erst 2 von 3 vollen Monaten");
	});

	it("keeps the fixed payments when they exceed the full months so far", () => {
		const basis = monthlyExpenseBasis({
			months: months([
				["2026-07", 10_000],
				["2026-08", 20_000],
				["2026-09", 5_000],
			]),
			firstBookingDate: "2026-07-01",
			today: "2026-09-10",
			recurringMonthlyMinor: 60_000,
		});
		expect(basis).toEqual({
			monthlyMinor: 60_000,
			source: "recurring",
			fullMonths: 2,
		});
	});

	it("falls back to the minimum and says why", () => {
		const reserve = requiredReserve({
			basis: { monthlyMinor: 0, source: "none", fullMonths: 1 },
			reserveMonths: 3,
			minimumReserveMinor: 1_000_000,
			currency: "EUR",
		});
		expect(reserve).toMatchObject({
			reserveMinor: 1_000_000,
			binding: "minimum",
		});
		expect(reserve.note).toContain("2 volle Monate");
	});

	it("takes the larger of months and minimum", () => {
		const basis = {
			monthlyMinor: 200_000,
			source: "history" as const,
			fullMonths: 6,
		};
		expect(
			requiredReserve({
				basis,
				reserveMonths: 3,
				minimumReserveMinor: 500_000,
				currency: "EUR",
			}),
		).toMatchObject({ reserveMinor: 600_000, binding: "months" });
		expect(
			requiredReserve({
				basis,
				reserveMonths: 3,
				minimumReserveMinor: 800_000,
				currency: "EUR",
			}),
		).toMatchObject({ reserveMinor: 800_000, binding: "minimum" });
	});

	it("has no reserve without spending and without a minimum", () => {
		expect(
			requiredReserve({
				basis: { monthlyMinor: 0, source: "none", fullMonths: 0 },
				reserveMonths: 3,
				minimumReserveMinor: null,
				currency: "EUR",
			}).reserveMinor,
		).toBeNull();
	});
});
