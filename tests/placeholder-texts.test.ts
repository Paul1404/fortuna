import { describe, expect, it } from "vitest";
import {
	type CategorisedPrior,
	proposeCategories,
	suggestionKey,
} from "@/domain/categorisation";
import { detectRecurring } from "@/domain/recurring";

// A bank sends "Ohne Verwendungszweck", the ISO domain code or nothing at all
// when it has no text, and often no counterparty either. Such a text names no
// merchant (AGENTS: `isEmptyBookingText`), yet the review and the recurring
// detection still grouped by it: a broker deposit and a refund, both without a
// counterparty, became "earlier bookings from Ohne Verwendungszweck".

const placeholderPrior = (amountMinor: number): CategorisedPrior => ({
	merchantName: null,
	description: "Ohne Verwendungszweck",
	counterpartyName: null,
	amountMinor,
	categoryId: "anlage",
	categorySource: "manual",
});

describe("booking texts that say nothing", () => {
	it("give no merchant key", () => {
		for (const text of ["Ohne Verwendungszweck", "PMNT", "  "])
			expect(suggestionKey(null, null, text, -44_500)).toBeNull();
		// A real counterparty still identifies the booking.
		expect(
			suggestionKey(
				null,
				"Beispiel Versand GmbH",
				"Ohne Verwendungszweck",
				-500,
			),
		).toBe("out|beispiel versand gmbh");
	});

	it("never propose a category from earlier placeholder bookings", () => {
		const { suggestions, notes } = proposeCategories({
			transactions: [
				{
					id: "t1",
					accountId: "a1",
					description: "Ohne Verwendungszweck",
					merchantName: null,
					counterpartyName: null,
					counterpartyIban: null,
					amountMinor: -2_000,
					recurringPaymentId: null,
				},
			],
			rules: [],
			merchantDefaults: new Map(),
			recurringCategories: new Map(),
			priorsByKey: new Map([
				[
					"out|ohne verwendungszweck",
					[placeholderPrior(-44_500), placeholderPrior(-9_900)],
				],
			]),
			categoryNames: new Map([["anlage", "Geldanlage"]]),
			ruleNames: new Map(),
		});
		expect(suggestions).toEqual([]);
		expect(notes.size).toBe(0);
	});

	it("are never grouped into a recurring payment", () => {
		const tx = (id: string, bookingDate: string, description: string) => ({
			id,
			accountId: "acc",
			bookingDate,
			amountMinor: -5_000,
			currency: "EUR",
			description,
		});
		expect(
			detectRecurring([
				tx("1", "2026-06-10", "Ohne Verwendungszweck"),
				tx("2", "2026-07-10", "Ohne Verwendungszweck"),
				tx("3", "2026-08-10", "Ohne Verwendungszweck"),
				tx("4", "2026-09-10", "PMNT"),
			]),
		).toEqual([]);
	});
});
