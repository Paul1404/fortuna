import { describe, expect, it } from "vitest";
import {
	detectInternalTransfers,
	matchPaypalFunding,
} from "@/domain/transfers";

describe("internal transfers", () => {
	it("pairs an outflow with an inflow of the same amount on another account within the window", () => {
		const pairs = detectInternalTransfers(
			[
				{
					id: "o",
					accountId: "a",
					bookingDate: "2026-09-01",
					amountMinor: -50000,
					currency: "EUR",
				},
				{
					id: "i",
					accountId: "b",
					bookingDate: "2026-09-02",
					amountMinor: 50000,
					currency: "EUR",
				},
				{
					id: "x",
					accountId: "a",
					bookingDate: "2026-09-02",
					amountMinor: 50000,
					currency: "EUR",
				},
				{
					id: "far",
					accountId: "c",
					bookingDate: "2026-09-20",
					amountMinor: 50000,
					currency: "EUR",
				},
			],
			new Set(),
		);
		expect(pairs).toEqual([{ outflowId: "o", inflowId: "i" }]);
	});
	it("never pairs across currencies or already grouped legs", () => {
		const pairs = detectInternalTransfers(
			[
				{
					id: "o",
					accountId: "a",
					bookingDate: "2026-09-01",
					amountMinor: -100,
					currency: "EUR",
				},
				{
					id: "i",
					accountId: "b",
					bookingDate: "2026-09-01",
					amountMinor: 100,
					currency: "USD",
				},
				{
					id: "g",
					accountId: "b",
					bookingDate: "2026-09-01",
					amountMinor: 100,
					currency: "EUR",
					transferGroupId: "existing",
				},
			],
			new Set(),
		);
		expect(pairs).toEqual([]);
	});
});

describe("PayPal funding", () => {
	const row = (
		id: string,
		bookingDate: string,
		amountMinor: number,
		currency = "EUR",
	) => ({ id, bookingDate, amountMinor, currency });

	it("pairs the bank debit with the payment it funded", () => {
		// The real case: PayPal pays the merchant, the bank is charged days later.
		const pairs = matchPaypalFunding(
			[row("bank-1", "2026-08-19", -107_900)],
			[row("pp-1", "2026-08-17", -107_900)],
		);
		expect(pairs).toEqual([{ bankId: "bank-1", paypalId: "pp-1" }]);
	});

	it("never pairs a debit that came before the payment", () => {
		expect(
			matchPaypalFunding(
				[row("bank-1", "2026-08-15", -107_900)],
				[row("pp-1", "2026-08-17", -107_900)],
			),
		).toEqual([]);
	});

	it("leaves an unrelated debit of the same amount alone", () => {
		expect(
			matchPaypalFunding(
				[row("bank-1", "2026-09-30", -107_900)],
				[row("pp-1", "2026-08-17", -107_900)],
			),
		).toEqual([]);
	});

	it("uses each bank debit once when an amount repeats", () => {
		const pairs = matchPaypalFunding(
			[row("bank-1", "2026-08-19", -300), row("bank-2", "2026-09-02", -300)],
			[row("pp-2", "2026-08-31", -300), row("pp-1", "2026-08-17", -300)],
		);
		// Oldest payment to the nearest later debit, then the next.
		expect(pairs).toEqual([
			{ bankId: "bank-1", paypalId: "pp-1" },
			{ bankId: "bank-2", paypalId: "pp-2" },
		]);
	});

	it("ignores refunds and other currencies", () => {
		expect(
			matchPaypalFunding(
				[row("bank-1", "2026-08-19", 107_900)],
				[row("pp-1", "2026-08-17", 107_900)],
			),
		).toEqual([]);
		expect(
			matchPaypalFunding(
				[row("bank-1", "2026-08-19", -107_900, "CHF")],
				[row("pp-1", "2026-08-17", -107_900, "EUR")],
			),
		).toEqual([]);
	});
});
