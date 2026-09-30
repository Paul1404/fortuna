import type { IsoDate } from "./dates";

// Currency conversion for aggregation. Rates are "1 base = rate quote" and
// looked up as the latest rate at or before the requested date. Conversions
// that lack a rate are reported, never silently zeroed or summed as-is.

export type FxRate = {
	date: IsoDate;
	base: string;
	quote: string;
	rate: number;
};

export type ConversionResult = {
	amountMinor: number;
	/** True when a rate was needed but none existed for the pair. */
	missing: boolean;
};

export class FxTable {
	private readonly byPair = new Map<string, FxRate[]>();

	constructor(rates: readonly FxRate[] = []) {
		for (const r of rates) {
			const key = pairKey(r.base, r.quote);
			const list = this.byPair.get(key) ?? [];
			list.push(r);
			this.byPair.set(key, list);
		}
		for (const list of this.byPair.values()) {
			list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
		}
	}

	/**
	 * Rate to convert 1 unit of `from` into `to` at `date`, or null.
	 *
	 * A pair may be stored either way round. The newer of the two readings at
	 * or before the date wins: preferring the direct pair kept an old CHF → EUR
	 * rate in force after a newer EUR → CHF one was entered, while the data
	 * quality card, which looks at both directions, called the rate current.
	 */
	rate(from: string, to: string, date: IsoDate): number | null {
		const f = from.toUpperCase();
		const t = to.toUpperCase();
		if (f === t) return 1;
		const direct = this.latest(f, t, date);
		const inverse = this.latest(t, f, date);
		const inverted =
			inverse && inverse.rate !== 0
				? { ...inverse, rate: 1 / inverse.rate }
				: null;
		if (direct && inverted) {
			if (direct.before !== inverted.before)
				return direct.before ? direct.rate : inverted.rate;
			// Both at or before the date: the newer. Both after it: the one
			// closest to it.
			const invertedCloser = direct.before
				? inverted.date > direct.date
				: inverted.date < direct.date;
			return invertedCloser ? inverted.rate : direct.rate;
		}
		return direct?.rate ?? inverted?.rate ?? null;
	}

	convert(
		amountMinor: number,
		from: string,
		to: string,
		date: IsoDate,
	): ConversionResult {
		const r = this.rate(from, to, date);
		if (r === null) return { amountMinor: 0, missing: true };
		return { amountMinor: Math.round(amountMinor * r), missing: false };
	}

	/**
	 * The latest rate at or before `date`; before history starts, the
	 * earliest one, marked `before: false`.
	 */
	private latest(
		base: string,
		quote: string,
		date: IsoDate,
	): { date: IsoDate; rate: number; before: boolean } | null {
		const list = this.byPair.get(pairKey(base, quote));
		if (!list || list.length === 0) return null;
		let found: FxRate | null = null;
		for (const r of list) {
			if (r.date <= date) found = r;
			else break;
		}
		if (found) return { date: found.date, rate: found.rate, before: true };
		return { date: list[0].date, rate: list[0].rate, before: false };
	}
}

function pairKey(base: string, quote: string): string {
	return `${base.toUpperCase()}/${quote.toUpperCase()}`;
}

/**
 * Sum a list of amounts in mixed currencies into one base-currency total.
 * Returns the total plus the currencies that could not be converted.
 */
export function sumInBase(
	items: readonly { amountMinor: number; currency: string; date?: IsoDate }[],
	base: string,
	fx: FxTable,
	date: IsoDate,
): { totalMinor: number; unconverted: string[] } {
	let total = 0;
	const unconverted = new Set<string>();
	for (const item of items) {
		const result = fx.convert(
			item.amountMinor,
			item.currency,
			base,
			item.date ?? date,
		);
		if (result.missing) unconverted.add(item.currency.toUpperCase());
		else total += result.amountMinor;
	}
	return { totalMinor: total, unconverted: Array.from(unconverted) };
}
