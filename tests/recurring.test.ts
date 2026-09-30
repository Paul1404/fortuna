import { describe, expect, it } from "vitest";
import {
	amountLevels,
	classifyInterval,
	detectRecurring,
	monthlyEquivalentMinor,
	nextExpectedDate,
} from "@/domain/recurring";

function tx(
	id: string,
	date: string,
	amount: number,
	description: string,
	extra: Partial<Parameters<typeof detectRecurring>[0][number]> = {},
) {
	return {
		id,
		accountId: "acc",
		bookingDate: date,
		amountMinor: amount,
		currency: "EUR",
		description,
		...extra,
	};
}

describe("recurring detection", () => {
	it("detects a monthly subscription with small amount and date jitter", () => {
		const result = detectRecurring([
			tx("1", "2026-03-04", -1099, "SPOTIFY AB EREF:1"),
			tx("2", "2026-04-05", -1099, "SPOTIFY AB EREF:2"),
			tx("3", "2026-05-04", -1199, "SPOTIFY AB EREF:3"),
			tx("4", "2026-06-06", -1199, "SPOTIFY AB EREF:4"),
			tx("5", "2026-07-04", -1199, "SPOTIFY AB EREF:5"),
			tx("9", "2026-07-10", -4321, "REWE"),
		]);
		expect(result).toHaveLength(1);
		const r = result[0];
		expect(r.frequency).toBe("monthly");
		expect(r.expectedAmountMinor).toBe(-1199);
		expect(r.transactionIds).toEqual(["1", "2", "3", "4", "5"]);
		expect(r.nextExpected).toBe("2026-08-04");
		expect(r.typicalDay).toBe(4);
	});

	it("detects quarterly and yearly cadences and ignores irregular merchants", () => {
		const result = detectRecurring([
			tx("q1", "2025-01-15", -9000, "Stadtwerke Abschlag"),
			tx("q2", "2025-04-14", -9000, "Stadtwerke Abschlag"),
			tx("q3", "2025-07-15", -9200, "Stadtwerke Abschlag"),
			tx("q4", "2025-10-15", -9200, "Stadtwerke Abschlag"),
			tx("y1", "2024-02-01", -32000, "Allianz Versicherung"),
			tx("y2", "2025-02-03", -33000, "Allianz Versicherung"),
			tx("y3", "2026-02-02", -34000, "Allianz Versicherung"),
			tx("i1", "2026-01-02", -1500, "Amazon"),
			tx("i2", "2026-01-09", -8800, "Amazon"),
			tx("i3", "2026-03-30", -300, "Amazon"),
		]);
		const byName = Object.fromEntries(result.map((r) => [r.name, r]));
		expect(byName["Stadtwerke Abschlag"].frequency).toBe("quarterly");
		expect(byName["Allianz Versicherung"].frequency).toBe("yearly");
		expect(byName.Amazon).toBeUndefined();
	});

	it("keeps a month-end payment on the 31st after a short month", () => {
		// The April booking is on the 30th only because April has no 31st.
		// Stepping a month from it projected 30 May, and every date after that
		// stayed a day early.
		const result = detectRecurring([
			tx("1", "2026-01-31", -120000, "Miete Wohnung"),
			tx("2", "2026-02-28", -120000, "Miete Wohnung"),
			tx("3", "2026-03-31", -120000, "Miete Wohnung"),
			tx("4", "2026-04-30", -120000, "Miete Wohnung"),
		]);
		expect(result).toHaveLength(1);
		expect(result[0].typicalDay).toBe(31);
		expect(result[0].nextExpected).toBe("2026-05-31");
	});

	it("steps from the payment's day, not a clamped month end", () => {
		expect(nextExpectedDate("2026-04-30", "monthly", 30, 31)).toBe(
			"2026-05-31",
		);
		expect(nextExpectedDate("2026-02-28", "quarterly", 91, 30)).toBe(
			"2026-05-30",
		);
		// A booking pulled to the month end by a weekend is not a clamped day.
		expect(nextExpectedDate("2026-05-31", "monthly", 30, 1)).toBe("2026-06-30");
		// Mid-month bookings keep their own day.
		expect(nextExpectedDate("2026-04-17", "monthly", 30, 31)).toBe(
			"2026-05-17",
		);
	});

	it("skips transfer legs", () => {
		const result = detectRecurring([
			tx("1", "2026-01-01", -50000, "Sparen", { transferGroupId: "g1" }),
			tx("2", "2026-02-01", -50000, "Sparen", { transferGroupId: "g2" }),
			tx("3", "2026-03-01", -50000, "Sparen", { transferGroupId: "g3" }),
		]);
		expect(result).toEqual([]);
	});

	it("classifies intervals and monthly equivalents", () => {
		expect(classifyInterval(29).frequency).toBe("monthly");
		expect(classifyInterval(14).frequency).toBe("biweekly");
		expect(classifyInterval(45).frequency).toBe("custom");
		expect(nextExpectedDate("2026-01-31", "monthly", 30)).toBe("2026-02-28");
		expect(monthlyEquivalentMinor(-12000, "yearly", 365)).toBe(-1000);
		expect(monthlyEquivalentMinor(-3000, "quarterly", 91)).toBe(-1000);
	});
});

describe("price changes", () => {
	const monthly = (amounts: number[]) =>
		amounts.map((amountMinor, index) => ({
			id: `t${index}`,
			accountId: "a1",
			bookingDate: `2026-0${index + 1}-15`,
			amountMinor: -amountMinor,
			currency: "EUR",
			description: "TELEKOM DEUTSCHLAND",
			merchantName: "Telekom",
			counterpartyName: null,
			categoryId: null,
			transferGroupId: null,
		}));

	it("separates the price now from the price before", () => {
		expect(amountLevels([4995, 4995, 4995, 5230, 5230])).toEqual({
			currentMinor: 5230,
			previousMinor: 4995,
			changedAt: 3,
		});
	});

	it("calls a single outlier noise, not a new price", () => {
		// One booking at a different amount is a correction, not a price.
		expect(
			amountLevels([4995, 4995, 4995, 4995, 5230]).previousMinor,
		).toBeNull();
	});

	it("says nothing when the amount never moved", () => {
		expect(amountLevels([4995, 4995, 4995, 4995]).previousMinor).toBeNull();
		// Small wobble around one price is still one price.
		expect(amountLevels([4995, 5000, 4990, 4995]).previousMinor).toBeNull();
	});

	it("needs a consistent old level before calling it a change", () => {
		expect(
			amountLevels([1000, 9000, 4000, 5230, 5230]).previousMinor,
		).toBeNull();
	});

	it("projects the new price, not the median across the rise", () => {
		const detected = detectRecurring(
			monthly([4995, 4995, 4995, 5230, 5230, 5230]),
		);
		expect(detected).toHaveLength(1);
		// The median over everything would be 5112,5 — an amount never charged.
		expect(detected[0].expectedAmountMinor).toBe(-5230);
		expect(detected[0].priceChange).toMatchObject({
			fromMinor: 4995,
			toMinor: 5230,
			since: "2026-04-15",
		});
		// Roughly twelve times the monthly difference.
		expect(detected[0].priceChange?.annualDifferenceMinor).toBeGreaterThan(
			2700,
		);
		expect(detected[0].priceChange?.annualDifferenceMinor).toBeLessThan(2960);
	});

	it("leaves a steady payment without a price change", () => {
		const detected = detectRecurring(monthly([4995, 4995, 4995, 4995]));
		expect(detected[0]?.priceChange).toBeNull();
	});
});

describe("two payments under one merchant", () => {
	// The real case: a mobile contract around 35 € and a TV subscription at
	// exactly 10 €, both from Telekom, both monthly, interleaved in time.
	const telekom = [
		["2026-06-29", 3504, "Mobilfunk Kundenkonto 0066984993 RG 3463"],
		["2026-07-13", 1000, "Magenta TV Kundennummer 7301726479 RG 00"],
		["2026-07-27", 3495, "Mobilfunk Kundenkonto 0066984993 RG 3474"],
		["2026-08-17", 1000, "Magenta TV Kundennummer 7301726479 RG 00"],
		["2026-08-31", 3517, "Mobilfunk Kundenkonto 0066984993 RG 3485"],
		["2026-09-14", 1000, "Magenta TV Kundennummer 7301726479 RG 00"],
	].map(([bookingDate, amount, description], index) => ({
		id: `t${index}`,
		accountId: "a1",
		bookingDate: bookingDate as string,
		amountMinor: -(amount as number),
		currency: "EUR",
		description: description as string,
		merchantName: "Telekom Deutschland GmbH",
		counterpartyName: null,
		categoryId: null,
		transferGroupId: null,
	}));

	it("finds both instead of discarding the merchant", () => {
		const found = detectRecurring(telekom).sort(
			(left, right) => right.expectedAmountMinor - left.expectedAmountMinor,
		);
		// Together the amounts look erratic; apart, each is a clean monthly.
		expect(found).toHaveLength(2);
		expect(found.map((row) => row.expectedAmountMinor)).toEqual([-1000, -3504]);
		expect(found.every((row) => row.frequency === "monthly")).toBe(true);
	});

	it("names them so they can be told apart", () => {
		const names = detectRecurring(telekom).map((row) => row.name);
		expect(names).toContain("Telekom Deutschland GmbH · Magenta TV");
		expect(names.some((name) => name.includes("Mobilfunk"))).toBe(true);
	});

	it("gives each booking to exactly one payment", () => {
		const ids = detectRecurring(telekom).flatMap((row) => row.transactionIds);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("leaves a single-purpose merchant unsplit and unsuffixed", () => {
		const plain = telekom
			.filter((row) => row.description.startsWith("Mobilfunk"))
			.map((row) => ({ ...row, merchantName: "Nur Mobilfunk" }));
		const found = detectRecurring(plain);
		expect(found).toHaveLength(1);
		expect(found[0].name).toBe("Nur Mobilfunk");
	});
});
