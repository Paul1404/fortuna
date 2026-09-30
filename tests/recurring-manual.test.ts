import { describe, expect, it } from "vitest";
import {
	fallbackNextExpected,
	type ManualRecurring,
	manualPaymentFor,
} from "@/domain/recurring";

// The owner entered an insurance premium and a TV subscription by hand before
// detection ever ran. Detection must recognise those payments as theirs and
// link the bookings to them, not add a second, automatic copy of each — two
// rows for one premium are counted twice on /fixed-costs and in the forecast.

const detected = {
	accountId: "acc",
	direction: "outflow" as const,
	currency: "EUR",
	expectedAmountMinor: -2_270,
	frequency: "monthly" as const,
	categoryId: "insurance",
	transactionIds: ["b1", "b2", "b3"],
};

const manual = (over: Partial<ManualRecurring> = {}): ManualRecurring => ({
	id: "m1",
	accountId: "acc",
	direction: "outflow",
	currency: "EUR",
	expectedAmountMinor: -2_270,
	frequency: "monthly",
	categoryId: "insurance",
	...over,
});

describe("matching a detected payment to one the owner entered", () => {
	it("claims the manual payment that already owns one of the bookings", () => {
		expect(
			manualPaymentFor(
				{ ...detected, categoryId: "other" },
				[manual({ id: "tv", expectedAmountMinor: -9_999 })],
				new Map([["b2", "tv"]]),
			),
		).toBe("tv");
	});

	it("claims a manual payment without bookings by account, amount and cadence", () => {
		expect(manualPaymentFor(detected, [manual()], new Map())).toBe("m1");
		expect(
			manualPaymentFor(
				detected,
				[manual({ accountId: null, categoryId: null })],
				new Map(),
			),
		).toBe("m1");
	});

	it("does not claim a different payment", () => {
		for (const other of [
			manual({ frequency: "yearly" }),
			manual({ direction: "inflow", expectedAmountMinor: 2_270 }),
			manual({ expectedAmountMinor: -4_200 }),
			manual({ currency: "CHF" }),
			manual({ categoryId: "car" }),
			manual({ accountId: "elsewhere" }),
		])
			expect(manualPaymentFor(detected, [other], new Map())).toBeNull();
	});

	it("leaves an ambiguous match alone", () => {
		expect(
			manualPaymentFor(
				detected,
				[manual({ id: "a" }), manual({ id: "b", accountId: null })],
				new Map(),
			),
		).toBeNull();
	});
});

describe("a monthly payment without a stored due date", () => {
	it("falls due on its typical day, not today", () => {
		expect(fallbackNextExpected("2026-09-28", "monthly", 15)).toBe(
			"2026-10-15",
		);
		expect(fallbackNextExpected("2026-09-10", "monthly", 15)).toBe(
			"2026-09-15",
		);
		expect(fallbackNextExpected("2026-09-15", "monthly", 15)).toBe(
			"2026-09-15",
		);
		expect(fallbackNextExpected("2026-02-10", "monthly", 31)).toBe(
			"2026-02-28",
		);
		expect(fallbackNextExpected("2026-02-28", "monthly", 30)).toBe(
			"2026-02-28",
		);
	});

	it("keeps today where the due day or month is unknown", () => {
		expect(fallbackNextExpected("2026-09-28", "monthly", null)).toBe(
			"2026-09-28",
		);
		expect(fallbackNextExpected("2026-09-28", "yearly", 15)).toBe("2026-09-28");
	});
});
