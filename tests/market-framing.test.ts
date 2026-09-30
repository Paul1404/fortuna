import { describe, expect, it } from "vitest";
import {
	depotAgainstCost,
	heroFraming,
	isDownDay,
} from "@/domain/market-framing";

const pulse = (confirmed: number | null, indicative: number | null) => ({
	status: "available",
	confirmedNetWorthMinor: confirmed,
	indicativeNetWorthMinor: indicative,
});

describe("isDownDay", () => {
	it("is a reading below the confirmed snapshot on screen", () => {
		expect(isDownDay(pulse(1_000_000, 990_000), 1_000_000)).toBe(true);
	});

	it("is not a down day when up or flat", () => {
		expect(isDownDay(pulse(1_000_000, 1_010_000), 1_000_000)).toBe(false);
		expect(isDownDay(pulse(1_000_000, 1_000_000), 1_000_000)).toBe(false);
	});

	it("never judges without a real reading for this snapshot", () => {
		expect(isDownDay(undefined, 1_000_000)).toBe(false);
		expect(isDownDay(null, 1_000_000)).toBe(false);
		expect(isDownDay(pulse(1_000_000, null), 1_000_000)).toBe(false);
		expect(
			isDownDay({ ...pulse(1_000_000, 990_000), status: "stale" }, 1_000_000),
		).toBe(false);
		// A reading computed for another snapshot (a sync landed in between).
		expect(isDownDay(pulse(1_200_000, 990_000), 1_000_000)).toBe(false);
	});
});

describe("heroFraming", () => {
	const yearAgo = { date: "2025-09-30", netWorthMinor: 800_000 };
	const depot = { valueMinor: 500_000, costBasisMinor: 420_000 };

	it("shows what it shows today on an up or flat day", () => {
		expect(
			heroFraming({ down: false, liveNetWorthMinor: 990_000, yearAgo, depot }),
		).toEqual({ kind: "today" });
	});

	it("takes the year view on a down day, from the real reading", () => {
		expect(
			heroFraming({ down: true, liveNetWorthMinor: 990_000, yearAgo, depot }),
		).toEqual({ kind: "year", sinceDate: "2025-09-30", changeMinor: 190_000 });
	});

	it("falls back to the depot against its cost, then to nothing new", () => {
		expect(
			heroFraming({
				down: true,
				liveNetWorthMinor: 990_000,
				yearAgo: null,
				depot,
			}),
		).toEqual({ kind: "costBasis", gainMinor: 80_000 });
		expect(
			heroFraming({
				down: true,
				liveNetWorthMinor: 990_000,
				yearAgo: null,
				depot: null,
			}),
		).toEqual({ kind: "today" });
	});

	it("reports a year that is itself down as it is, not hidden", () => {
		expect(
			heroFraming({
				down: true,
				liveNetWorthMinor: 700_000,
				yearAgo,
				depot: null,
			}),
		).toEqual({ kind: "year", sinceDate: "2025-09-30", changeMinor: -100_000 });
	});
});

describe("depotAgainstCost", () => {
	const position = {
		accountId: "depot",
		isin: "LU2903252349",
		currency: "EUR",
		valueMinor: 719_339,
		costBasisMinor: 600_000,
	};

	it("adds the pulse's moves of that depot only", () => {
		expect(
			depotAgainstCost(
				[
					position,
					{
						...position,
						accountId: "other",
						valueMinor: 100_000,
						costBasisMinor: 90_000,
					},
				],
				{
					accountId: "depot",
					positions: [
						{ isin: "LU2903252349", deltaMinor: -9_339, currency: "EUR" },
					],
				},
				"EUR",
			),
		).toEqual({ valueMinor: 810_000, costBasisMinor: 690_000 });
	});

	it("refuses a partial comparison rather than guess", () => {
		expect(depotAgainstCost([], null, "EUR")).toBeNull();
		expect(
			depotAgainstCost([{ ...position, costBasisMinor: null }], null, "EUR"),
		).toBeNull();
		expect(
			depotAgainstCost([{ ...position, currency: "USD" }], null, "EUR"),
		).toBeNull();
		expect(
			depotAgainstCost([{ ...position, valueMinor: null }], null, "EUR"),
		).toBeNull();
	});
});
