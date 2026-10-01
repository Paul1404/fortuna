import { describe, expect, it } from "vitest";
import {
	composeMonthlyRecap,
	monthCovered,
	type RecapInput,
} from "@/domain/monthly-recap";

const august: RecapInput = {
	month: "2026-08",
	currency: "EUR",
	firstBookingDate: "2026-05-02",
	current: {
		incomeMinor: 421_000,
		expenseMinor: 315_000,
		netMinor: 106_000,
		transactionCount: 64,
	},
	previous: { incomeMinor: 420_000, expenseMinor: 292_000, netMinor: 128_000 },
	topCategory: { name: "Wohnen", amountMinor: 120_000 },
	netWorth: {
		startMinor: 5_000_000,
		endMinor: 5_150_000,
		excludesDepot: false,
	},
	observations: [],
};

/** Intl puts a no-break space before the euro sign. */
const plain = (text: string) => text.replace(/ /g, " ");

describe("month recap", () => {
	it("says it in three sentences, from the numbers alone", () => {
		const recap = composeMonthlyRecap(august);
		expect(recap.title).toBe("Ihr August in drei Sätzen");
		expect(recap.enoughData).toBe(true);
		expect(recap.sentences.map(plain)).toEqual([
			"Im August kamen 4.210 € herein und 3.150 € gingen hinaus, übrig blieben 1.060 € – 25 % vom Einkommen.",
			"Am meisten ging für Wohnen weg (1.200 €), insgesamt 230 € mehr als im Juli.",
			"Das Vermögen wuchs um 1.500 €; sonst ist nichts aufgefallen, alles in Ordnung.",
		]);
		expect(recap.numbers).toMatchObject({
			incomeMinor: 421_000,
			expenseMinor: 315_000,
			netMinor: 106_000,
			savingsRateBps: 2_518,
			expenseChangeMinor: 23_000,
			topCategory: { name: "Wohnen", amountMinor: 120_000 },
			netWorthChangeMinor: 150_000,
			notable: null,
		});
	});

	it("is the same text for the same month every time", () => {
		expect(composeMonthlyRecap(august)).toEqual(composeMonthlyRecap(august));
	});

	it("names a month that cost more than came in, and the loudest observation", () => {
		const recap = composeMonthlyRecap({
			...august,
			current: {
				incomeMinor: 350_000,
				expenseMinor: 390_000,
				netMinor: -40_000,
				transactionCount: 40,
			},
			previous: {
				incomeMinor: 350_000,
				expenseMinor: 388_000,
				netMinor: -38_000,
			},
			netWorth: {
				startMinor: 5_000_000,
				endMinor: 4_960_000,
				excludesDepot: true,
			},
			observations: [
				{ title: "Kleine Abos, relevante Jahressumme", severity: "review" },
				{ title: "Liquiditätsreserve unterschritten", severity: "urgent" },
			],
		});
		expect(recap.sentences.map(plain)).toEqual([
			"Im August gingen 3.900 € hinaus, herein kamen nur 3.500 €: 400 € mehr ausgegeben als eingenommen.",
			"Am meisten ging für Wohnen weg (1.200 €), insgesamt ungefähr so viel wie im Juli.",
			"Das Vermögen ohne Depot sank um 400 €; aufgefallen ist: Liquiditätsreserve unterschritten.",
		]);
		expect(recap.numbers.savingsRateBps).toBe(-1_143);
		expect(recap.numbers.observationCount).toBe(2);
	});

	it("says so when there is nothing to compare with", () => {
		const recap = composeMonthlyRecap({
			...august,
			previous: null,
			netWorth: null,
			topCategory: { name: "Nicht kategorisiert", amountMinor: 80_000 },
		});
		expect(recap.sentences.map(plain)).toEqual([
			"Im August kamen 4.210 € herein und 3.150 € gingen hinaus, übrig blieben 1.060 € – 25 % vom Einkommen.",
			"Der größte Posten ist noch nicht zugeordnet (800 €), einen Vergleich mit Juli gibt es noch nicht.",
			"Sonst ist nichts aufgefallen, alles in Ordnung.",
		]);
		expect(recap.numbers.expenseChangeMinor).toBeNull();
		expect(recap.numbers.netWorthChangeMinor).toBeNull();
	});

	it("admits a month with too few bookings instead of guessing", () => {
		const few = composeMonthlyRecap({
			...august,
			current: {
				incomeMinor: 0,
				expenseMinor: 4_500,
				netMinor: -4_500,
				transactionCount: 3,
			},
		});
		expect(few.enoughData).toBe(false);
		expect(few.sentences[0]).toBe("Für August liegen zu wenige Buchungen vor.");
		expect(few.sentences).toHaveLength(3);
		expect(few.sentences.join(" ")).not.toMatch(/€/);

		// Data that only starts in the middle of the month is not the month.
		const late = composeMonthlyRecap({
			...august,
			firstBookingDate: "2026-08-14",
		});
		expect(late.enoughData).toBe(false);
		expect(late.sentences[0]).toBe(
			"Für August liegen zu wenige Buchungen vor.",
		);
	});

	it("counts a month as covered only when the data starts in its first days", () => {
		expect(monthCovered("2026-08", "2026-08-03")).toBe(true);
		expect(monthCovered("2026-08", "2026-08-05")).toBe(false);
		expect(monthCovered("2026-08", "2025-01-01")).toBe(true);
		expect(monthCovered("2026-08", null)).toBe(false);
	});
});
