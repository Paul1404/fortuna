import { describe, expect, it } from "vitest";
import { depotIndicative } from "@/domain/scalable-market-pulse";
import { indicativeNetWorth } from "@/lib/market-pulse";

describe("depotIndicative", () => {
	it("moves a depot figure by the quotes of its own snapshot", () => {
		expect(
			depotIndicative(
				909_559,
				"EUR",
				[
					{ deltaMinor: 1_250, currency: "EUR" },
					{ deltaMinor: -300, currency: "EUR" },
				],
				true,
			),
		).toBe(910_509);
	});

	it("keeps the booked figure for another snapshot or currency", () => {
		const moves = [{ deltaMinor: 1_250, currency: "EUR" }];
		expect(depotIndicative(909_559, "EUR", moves, false)).toBe(909_559);
		expect(depotIndicative(909_559, "USD", moves, true)).toBe(909_559);
		expect(depotIndicative(null, "EUR", moves, true)).toBeNull();
	});
});

describe("indicativeNetWorth", () => {
	const pulse = {
		status: "available" as const,
		confirmedNetWorthMinor: 5_918_000,
		indicativeNetWorthMinor: 5_921_450,
	};

	it("shows the quote-moved figure only against its own snapshot", () => {
		// biome-ignore lint/suspicious/noExplicitAny: partial pulse fixture
		expect(indicativeNetWorth(5_918_000, pulse as any)).toBe(5_921_450);
		// biome-ignore lint/suspicious/noExplicitAny: partial pulse fixture
		expect(indicativeNetWorth(5_900_000, pulse as any)).toBe(5_900_000);
	});

	it("shows the booked figure while the market is closed or unknown", () => {
		expect(
			// biome-ignore lint/suspicious/noExplicitAny: partial pulse fixture
			indicativeNetWorth(5_918_000, { ...pulse, status: "stale" } as any),
		).toBe(5_918_000);
		expect(indicativeNetWorth(5_918_000, undefined)).toBe(5_918_000);
	});
});
