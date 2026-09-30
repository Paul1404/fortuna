import { describe, expect, it } from "vitest";
import {
	detectDelimiter,
	guessDateFormat,
	guessMapping,
	mapRows,
	parseCsv,
	toCsv,
} from "@/domain/csv";

describe("csv", () => {
	const german = `Buchungstag;Valutadatum;Auftraggeber / Begünstigter;Verwendungszweck;IBAN;Betrag;Währung\r\n01.09.2026;01.09.2026;"REWE SAGT DANKE";Kartenzahlung 31.08.26;DE00123;-64,18;EUR\r\n02.09.2026;;Arbeitgeber GmbH;"Gehalt September; Zeile 2";DE00999;"5.420,00";EUR\r\n`;

	it("parses quoted fields and semicolon delimiters", () => {
		expect(detectDelimiter(german)).toBe(";");
		const rows = parseCsv(german);
		expect(rows).toHaveLength(3);
		expect(rows[2][3]).toBe("Gehalt September; Zeile 2");
	});

	it("guesses a mapping from German headers and maps rows", () => {
		const rows = parseCsv(german);
		const guess = guessMapping(rows[0]);
		expect(guess.bookingDate).toBe(0);
		expect(guess.amount).toBe(5);
		expect(guess.description).toBe(3);
		expect(guess.counterpartyName).toBe(2);
		expect(guessDateFormat(rows.slice(1).map((r) => r[0]))).toBe("dmy");
		const mapped = mapRows(rows, { ...guess, dateFormat: "dmy" } as Parameters<
			typeof mapRows
		>[1]);
		expect(mapped.errors).toEqual([]);
		expect(mapped.rows[0]).toMatchObject({
			bookingDate: "2026-09-01",
			amountMinor: -6418,
			counterpartyName: "REWE SAGT DANKE",
			currency: "EUR",
		});
		expect(mapped.rows[1]).toMatchObject({
			bookingDate: "2026-09-02",
			valueDate: null,
			amountMinor: 542000,
		});
	});

	it("supports debit/credit columns and reports bad rows", () => {
		const text =
			"Date,Debit,Credit,Description\n2026-09-01,12.50,,Coffee\n2026-09-02,,100.00,Refund\nnot-a-date,1,,x\n";
		const rows = parseCsv(text);
		const mapped = mapRows(rows, {
			bookingDate: 0,
			debit: 1,
			credit: 2,
			amount: 1,
			description: 3,
			dateFormat: "iso",
		});
		expect(mapped.rows.map((r) => r.amountMinor)).toEqual([-1250, 10000]);
		expect(mapped.errors).toEqual([
			{ row: 4, message: "Buchungsdatum „not-a-date“ ist nicht lesbar" },
		]);
	});

	it("serialises with escaping", () => {
		expect(
			toCsv([
				["a", 'say "hi"', "x,y"],
				[1, null, undefined],
			]),
		).toBe('a,"say ""hi""","x,y"\r\n1,,\r\n');
	});

	it("reports an unreadable debit or credit cell instead of importing zero", () => {
		const csv =
			"Datum;Soll;Haben;Zweck\n02.01.2026;1.234,56 EUR;;Miete\n03.01.2026;;50,00;Gehalt\n";
		const result = mapRows(parseCsv(csv), {
			bookingDate: 0,
			debit: 1,
			credit: 2,
			description: 3,
			dateFormat: "dmy",
		});
		expect(result.errors).toMatchObject([
			{ row: 2, message: expect.stringContaining("1.234,56 EUR") },
		]);
		expect(result.rows).toMatchObject([{ amountMinor: 5000 }]);
	});

	it("maps Fortuna's own transaction export back onto its columns", () => {
		// The header exportTransactionsCsv writes, one booking below it.
		const exported = toCsv([
			[
				"id",
				"konto",
				"buchungsdatum",
				"wertstellung",
				"betrag",
				"waehrung",
				"beschreibung",
				"gegenpartei",
				"gegenpartei_iban",
				"haendler",
				"kategorie",
				"typ",
				"status",
				"umbuchungsgruppe",
				"wiederkehrende_zahlung_id",
				"externe_id",
				"importquelle",
				"notizen",
			],
			[
				"0b6f5c1e-internal",
				"Giro",
				"2026-09-01",
				"2026-09-01",
				"-64.18",
				"EUR",
				"Kartenzahlung REWE",
				"REWE",
				"DE00123",
				"REWE",
				"Lebensmittel",
				"payment",
				"booked",
				null,
				null,
				"bank-4711",
				"provider",
				null,
			],
		]);
		const rows = parseCsv(exported);
		const guess = guessMapping(rows[0]);
		expect(guess).toMatchObject({
			bookingDate: 2,
			valueDate: 3,
			amount: 4,
			currency: 5,
			description: 6,
			counterpartyName: 7,
			counterpartyIban: 8,
			externalId: 15,
		});
		const mapped = mapRows(rows, guess as Parameters<typeof mapRows>[1]);
		expect(mapped.errors).toEqual([]);
		expect(mapped.rows[0]).toMatchObject({
			bookingDate: "2026-09-01",
			amountMinor: -6418,
			description: "Kartenzahlung REWE",
			counterpartyName: "REWE",
			externalId: "bank-4711",
		});
	});
});
