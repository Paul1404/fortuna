import { isIsoDate } from "./dates";
import { parseDecimalToMinor } from "./money";

// CSV parsing and column mapping for bank exports. The parser is RFC 4180
// tolerant (quotes, embedded newlines, ; or , or tab separators) and the
// mapper turns rows into the canonical transaction shape used by the importer.

export function detectDelimiter(sample: string): string {
	const firstLine =
		sample.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
	const counts = [";", ",", "\t", "|"].map((d) => ({
		d,
		n: firstLine.split(d).length,
	}));
	counts.sort((a, b) => b.n - a.n);
	return counts[0].n > 1 ? counts[0].d : ",";
}

export function parseCsv(text: string, delimiter?: string): string[][] {
	const input = text.replace(/^﻿/, "");
	const d = delimiter ?? detectDelimiter(input);
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let inQuotes = false;
	for (let i = 0; i < input.length; i++) {
		const c = input[i];
		if (inQuotes) {
			if (c === '"') {
				if (input[i + 1] === '"') {
					field += '"';
					i++;
				} else inQuotes = false;
			} else field += c;
			continue;
		}
		if (c === '"') inQuotes = true;
		else if (c === d) {
			row.push(field);
			field = "";
		} else if (c === "\n" || c === "\r") {
			if (c === "\r" && input[i + 1] === "\n") i++;
			row.push(field);
			field = "";
			if (row.some((f) => f.trim() !== "")) rows.push(row);
			row = [];
		} else field += c;
	}
	row.push(field);
	if (row.some((f) => f.trim() !== "")) rows.push(row);
	return rows;
}

export type ColumnMapping = {
	bookingDate: number;
	valueDate?: number;
	amount?: number;
	/** Optional separate debit/credit columns (amount then ignored when both set). */
	debit?: number;
	credit?: number;
	description: number;
	counterpartyName?: number;
	counterpartyIban?: number;
	currency?: number;
	externalId?: number;
	dateFormat: "iso" | "dmy" | "mdy";
};

export type MappedRow = {
	bookingDate: string;
	valueDate: string | null;
	amountMinor: number;
	currency: string | null;
	description: string;
	counterpartyName: string | null;
	counterpartyIban: string | null;
	externalId: string | null;
};

export type MappingError = { row: number; message: string };

const HEADER_HINTS: Record<keyof Omit<ColumnMapping, "dateFormat">, RegExp[]> =
	{
		bookingDate: [
			/^buchungstag$/i,
			/^buchungsdatum$/i,
			/^booking ?date$/i,
			/^date$/i,
			/^datum$/i,
			/^transaction ?date$/i,
		],
		valueDate: [/^valuta/i, /^wertstellung/i, /^value ?date$/i],
		amount: [/^betrag/i, /^amount/i, /^umsatz$/i],
		debit: [/^soll$/i, /^debit$/i, /^ausgang$/i, /^lastschrift$/i],
		credit: [/^haben$/i, /^credit$/i, /^eingang$/i, /^gutschrift$/i],
		description: [
			/verwendungszweck/i,
			/^buchungstext/i,
			/^description$/i,
			/^purpose$/i,
			/^memo$/i,
			/^text$/i,
			/^details$/i,
			// Fortuna's own transaction export.
			/^beschreibung$/i,
		],
		counterpartyName: [
			/auftraggeber|beg(ü|ue)nstigter|zahlungspflichtiger|empf(ä|ae)nger|name des/i,
			/^payee$/i,
			/^counterparty/i,
			/^name$/i,
			/^merchant$/i,
			/^gegenpartei$/i,
		],
		counterpartyIban: [/iban/i],
		currency: [/^w(ä|ae)hrung$/i, /^currency$/i, /^ccy$/i],
		// Fortuna's own export carries its internal row id in "id" and the
		// source's id in "externe_id"; only the latter identifies a booking.
		externalId: [
			/^externe[_ ]?id$/i,
			/^id$/i,
			/transaction ?id/i,
			/^reference$/i,
			/^referenz$/i,
		],
	};

export function guessMapping(
	header: readonly string[],
): Partial<ColumnMapping> {
	const mapping: Partial<ColumnMapping> = { dateFormat: "iso" };
	const cleaned = header.map((h) => h.trim());
	for (const [field, patterns] of Object.entries(HEADER_HINTS) as [
		keyof Omit<ColumnMapping, "dateFormat">,
		RegExp[],
	][]) {
		for (const p of patterns) {
			const idx = cleaned.findIndex((h) => p.test(h));
			if (idx >= 0) {
				mapping[field] = idx;
				break;
			}
		}
	}
	return mapping;
}

export function guessDateFormat(
	samples: readonly string[],
): ColumnMapping["dateFormat"] {
	for (const s of samples) {
		const v = s.trim();
		if (/^\d{4}-\d{2}-\d{2}/.test(v)) return "iso";
		const m = v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
		if (m) {
			if (Number(m[1]) > 12) return "dmy";
			if (Number(m[2]) > 12) return "mdy";
			return v.includes(".") ? "dmy" : "mdy";
		}
	}
	return "iso";
}

export function parseDate(
	value: string,
	format: ColumnMapping["dateFormat"],
): string | null {
	const v = value.trim();
	if (v === "") return null;
	if (format === "iso") {
		const iso = v.slice(0, 10);
		return isIsoDate(iso) ? iso : null;
	}
	const m = v.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
	if (!m) return null;
	const [a, b, yRaw] = [m[1], m[2], m[3]];
	const year = yRaw.length === 2 ? `20${yRaw}` : yRaw;
	const day = format === "dmy" ? a : b;
	const month = format === "dmy" ? b : a;
	const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
	return isIsoDate(iso) ? iso : null;
}

export function mapRows(
	rows: readonly string[][],
	mapping: ColumnMapping,
	options: { hasHeader?: boolean } = {},
): { rows: MappedRow[]; errors: MappingError[] } {
	const out: MappedRow[] = [];
	const errors: MappingError[] = [];
	const start = options.hasHeader === false ? 0 : 1;
	for (let i = start; i < rows.length; i++) {
		const r = rows[i];
		const cell = (idx: number | undefined) =>
			idx === undefined ? "" : (r[idx] ?? "").trim();
		const bookingDate = parseDate(
			cell(mapping.bookingDate),
			mapping.dateFormat,
		);
		if (!bookingDate) {
			errors.push({
				row: i + 1,
				message: `Buchungsdatum „${cell(mapping.bookingDate)}“ ist nicht lesbar`,
			});
			continue;
		}
		let amountMinor: number | null = null;
		if (mapping.debit !== undefined && mapping.credit !== undefined) {
			// An empty column means zero; a filled one that will not parse is an
			// error, never a silent 0,00 € booking.
			const debitCell = cell(mapping.debit);
			const creditCell = cell(mapping.credit);
			const debit = debitCell ? parseDecimalToMinor(debitCell) : 0;
			const credit = creditCell ? parseDecimalToMinor(creditCell) : 0;
			if (debit === null || credit === null) {
				errors.push({
					row: i + 1,
					message: `Betrag „${debit === null ? debitCell : creditCell}“ ist nicht lesbar`,
				});
				continue;
			}
			amountMinor = credit - Math.abs(debit);
		} else {
			amountMinor = parseDecimalToMinor(cell(mapping.amount));
			if (amountMinor === null) {
				errors.push({
					row: i + 1,
					message: `Betrag „${cell(mapping.amount)}“ ist nicht lesbar`,
				});
				continue;
			}
		}
		const description = cell(mapping.description);
		const counterpartyName = cell(mapping.counterpartyName) || null;
		if (!description && !counterpartyName) {
			errors.push({
				row: i + 1,
				message: "Zeile enthält weder Beschreibung noch Gegenpartei",
			});
			continue;
		}
		out.push({
			bookingDate,
			valueDate:
				mapping.valueDate !== undefined
					? parseDate(cell(mapping.valueDate), mapping.dateFormat)
					: null,
			amountMinor,
			currency: cell(mapping.currency)
				? cell(mapping.currency).toUpperCase()
				: null,
			description: description || counterpartyName || "",
			counterpartyName,
			counterpartyIban: cell(mapping.counterpartyIban)
				? cell(mapping.counterpartyIban).replace(/\s/g, "").toUpperCase()
				: null,
			externalId: cell(mapping.externalId) || null,
		});
	}
	return { rows: out, errors };
}

export function toCsv(
	rows: readonly (string | number | null | undefined)[][],
	delimiter = ",",
): string {
	const escapeCell = (v: string | number | null | undefined): string => {
		const s = v === null || v === undefined ? "" : String(v);
		return /[",\n\r;\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	return `${rows.map((r) => r.map(escapeCell).join(delimiter)).join("\r\n")}\r\n`;
}
