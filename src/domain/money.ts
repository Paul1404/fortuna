// Money is an integer amount of minor units plus an ISO currency code. All
// arithmetic on money in Fortuna goes through these helpers so nothing is ever
// added across currencies by accident.

export type Money = { amountMinor: number; currency: string };

export class CurrencyMismatchError extends Error {
	constructor(a: string, b: string) {
		super(`${a} und ${b} können ohne Umrechnung nicht kombiniert werden`);
		this.name = "CurrencyMismatchError";
	}
}

export function money(amountMinor: number, currency: string): Money {
	return {
		amountMinor: Math.round(amountMinor),
		currency: currency.toUpperCase(),
	};
}

export function add(a: Money, b: Money): Money {
	if (a.currency !== b.currency)
		throw new CurrencyMismatchError(a.currency, b.currency);
	return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function sumMinor(values: readonly number[]): number {
	let total = 0;
	for (const v of values) total += v;
	return total;
}

/** Sum amounts that must all share one currency; throws on a mismatch. */
export function sumSameCurrency(
	values: readonly Money[],
	currency: string,
): Money {
	let total = 0;
	for (const v of values) {
		if (v.currency !== currency)
			throw new CurrencyMismatchError(currency, v.currency);
		total += v.amountMinor;
	}
	return { amountMinor: total, currency };
}

/**
 * Scale a plain decimal string to minor units without going through a float,
 * rounding a half cent away from zero. `value * 100` loses cases like "1.005",
 * which binary floating point stores just below the half.
 */
function decimalStringToMinor(normalized: string): number {
	const [whole, fraction = ""] = normalized.split(".");
	const cents = fraction.slice(0, 2).padEnd(2, "0");
	const rest = fraction.slice(2);
	const minor = Number(whole) * 100 + Number(cents);
	return rest && Number(rest[0]) >= 5 ? minor + 1 : minor;
}

export function parseDecimalToMinor(input: string | number): number | null {
	if (typeof input === "number") {
		if (!Number.isFinite(input)) return null;
		// toFixed gives the exact decimal digits; the scaling stays integer.
		const fixed = Math.abs(input).toFixed(10);
		const minor = decimalStringToMinor(fixed);
		return input < 0 ? -minor : minor;
	}
	let s = input.trim().replace(/\s/g, "").replace(/[€$£]/g, "");
	if (s === "") return null;
	// Trailing minus (some German exports write "12,34-").
	let negative = false;
	if (s.endsWith("-")) {
		negative = true;
		s = s.slice(0, -1);
	}
	if (s.startsWith("-") || s.startsWith("−")) {
		negative = !negative;
		s = s.slice(1);
	} else if (s.startsWith("+")) {
		s = s.slice(1);
	}
	const lastComma = s.lastIndexOf(",");
	const lastDot = s.lastIndexOf(".");
	let normalized: string;
	if (lastComma > lastDot) {
		// 1.234,56 -> comma is decimal separator
		normalized = s.replace(/\./g, "").replace(",", ".");
	} else if (lastDot > lastComma) {
		// 1,234.56 -> dot is decimal separator
		normalized = s.replace(/,/g, "");
	} else {
		normalized = s;
	}
	if (!/^\d+(\.\d{1,8})?$/.test(normalized)) return null;
	if (!Number.isFinite(Number(normalized))) return null;
	const minor = decimalStringToMinor(normalized);
	return negative ? -minor : minor;
}

export function minorToDecimalString(amountMinor: number): string {
	const negative = amountMinor < 0;
	const abs = Math.abs(amountMinor);
	const major = Math.floor(abs / 100);
	const minor = abs % 100;
	return `${negative ? "-" : ""}${major}.${String(minor).padStart(2, "0")}`;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function formatter(
	locale: string,
	currency: string,
	fractionDigits: number,
): Intl.NumberFormat {
	const key = `${locale}|${currency}|${fractionDigits}`;
	let f = formatterCache.get(key);
	if (!f) {
		f = new Intl.NumberFormat(locale, {
			style: "currency",
			currency,
			minimumFractionDigits: fractionDigits,
			maximumFractionDigits: fractionDigits,
		});
		formatterCache.set(key, f);
	}
	return f;
}

export type FormatMoneyOptions = {
	locale?: string;
	/** Drop minor units above 10,000 like the brand spec asks for tiles. */
	compact?: boolean;
	/** Show an explicit plus sign on positive amounts. */
	signed?: boolean;
};

/** Format minor units as a currency string using U+2212 for minus. */
export function formatMoney(
	amountMinor: number,
	currency: string,
	options: FormatMoneyOptions = {},
): string {
	const locale = options.locale ?? "de-DE";
	const abs = Math.abs(amountMinor);
	const digits = options.compact && abs >= 1_000_000 ? 0 : 2;
	const text = formatter(locale, currency, digits).format(abs / 100);
	if (amountMinor < 0) return `−${text}`;
	if (options.signed && amountMinor > 0) return `+${text}`;
	return text;
}

export function formatPercent(
	value: number,
	locale = "de-DE",
	digits = 1,
): string {
	const abs = Math.abs(value);
	const text = new Intl.NumberFormat(locale, {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
	}).format(abs);
	if (value < 0) return `−${text}%`;
	if (value > 0) return `+${text}%`;
	return `${text}%`;
}

export function formatNumber(
	value: number,
	locale = "de-DE",
	digits = 2,
): string {
	return new Intl.NumberFormat(locale, {
		minimumFractionDigits: 0,
		maximumFractionDigits: digits,
	}).format(value);
}

export function percentChange(from: number, to: number): number | null {
	if (from === 0) return null;
	return ((to - from) / Math.abs(from)) * 100;
}
