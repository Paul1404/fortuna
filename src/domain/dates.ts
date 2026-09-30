// Calendar helpers on ISO date strings (YYYY-MM-DD). All date arithmetic in the
// domain layer is done in UTC on these strings to avoid timezone drift.

export type IsoDate = string;

export function isIsoDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const d = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function toIsoDate(d: Date): IsoDate {
	return d.toISOString().slice(0, 10);
}

export function todayIso(now: Date = new Date()): IsoDate {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Europe/Berlin",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(now);
	const value = Object.fromEntries(
		parts.map((part) => [part.type, part.value]),
	);
	return `${value.year}-${value.month}-${value.day}`;
}

export function parseIso(value: IsoDate): Date {
	return new Date(`${value}T00:00:00Z`);
}

export function addDays(value: IsoDate, days: number): IsoDate {
	const d = parseIso(value);
	d.setUTCDate(d.getUTCDate() + days);
	return toIsoDate(d);
}

export function addMonths(value: IsoDate, months: number): IsoDate {
	const d = parseIso(value);
	const day = d.getUTCDate();
	d.setUTCDate(1);
	d.setUTCMonth(d.getUTCMonth() + months);
	const last = daysInMonth(toIsoDate(d));
	d.setUTCDate(Math.min(day, last));
	return toIsoDate(d);
}

export function daysInMonth(value: IsoDate): number {
	const d = parseIso(value);
	return new Date(
		Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
	).getUTCDate();
}

export function startOfMonth(value: IsoDate): IsoDate {
	return `${value.slice(0, 7)}-01`;
}

export function endOfMonth(value: IsoDate): IsoDate {
	return `${value.slice(0, 7)}-${String(daysInMonth(value)).padStart(2, "0")}`;
}

/** YYYY-MM key of a date. */
export function monthKey(value: IsoDate): string {
	return value.slice(0, 7);
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
	return Math.round(
		(parseIso(b).getTime() - parseIso(a).getTime()) / 86_400_000,
	);
}

export function minIso(a: IsoDate, b: IsoDate): IsoDate {
	return a < b ? a : b;
}

/** All month keys from `from` to `to` inclusive. */
export function monthRange(from: IsoDate, to: IsoDate): string[] {
	const out: string[] = [];
	let cursor = startOfMonth(from);
	const end = startOfMonth(to);
	while (cursor <= end) {
		out.push(monthKey(cursor));
		cursor = addMonths(cursor, 1);
	}
	return out;
}

export function monthLabel(key: string, locale = "de-DE"): string {
	const d = parseIso(`${key}-01`);
	return new Intl.DateTimeFormat(locale, {
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	}).format(d);
}

/**
 * A timestamp as the owner reads it: date and time in Berlin. Without a fixed
 * zone the server renders in its own zone (UTC on Railway) and the browser in
 * Berlin, so every timestamp moved by an hour or two during hydration and
 * React threw the server's HTML away.
 */
export function formatDateTime(value: Date | string, locale = "de-DE"): string {
	return new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "Europe/Berlin",
	}).format(new Date(value));
}
