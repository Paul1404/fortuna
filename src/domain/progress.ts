import { addDays, addMonths, endOfMonth, startOfMonth } from "./dates";
import { formatMoney } from "./money";

/**
 * Progress the owner controls: how much of the change in net worth they
 * saved themselves, how many full months in a row they did, and how full the
 * reserve pot is. Motivation attaches to behaviour, not to market noise, so
 * the market's part is shown beside the saving, never mixed into it.
 *
 * Pure and free of Node built-ins: the Vermögen page and the desk import it.
 */

/* ── Where the change came from ─────────────────────────────────────────── */

/** `month`: the running month; `last_month`: the one before; `year`: 1 Jan to today. */
export type GrowthPeriod = "month" | "last_month" | "year";
export const GROWTH_PERIODS: readonly GrowthPeriod[] = [
	"month",
	"last_month",
	"year",
];

export type GrowthWindow = {
	/** Net worth is read at the end of this day: the period's opening figure. */
	startDate: string;
	/** And at the end of this one: today, or the period's last day. */
	endDate: string;
	/** First day whose bookings count as saving: `startDate` + 1. */
	cashflowFrom: string;
	/** True when the period began before any data and starts later instead. */
	clamped: boolean;
};

/**
 * The window a period covers. Net worth at the end of `startDate` already
 * contains that day's bookings, so saving counts from the next day on; the
 * two figures then describe exactly the same stretch of time.
 *
 * `dataFrom` is the first day net worth counts any account. A period that
 * begins earlier starts there instead: before it the balance sheet is empty,
 * and every account would enter as if it had just been earned.
 */
export function growthWindow(
	period: GrowthPeriod,
	today: string,
	dataFrom: string | null,
): GrowthWindow | null {
	const first =
		period === "year"
			? `${today.slice(0, 4)}-01-01`
			: period === "month"
				? startOfMonth(today)
				: startOfMonth(addMonths(startOfMonth(today), -1));
	const last = period === "last_month" ? endOfMonth(first) : today;
	let startDate = addDays(first, -1);
	let clamped = false;
	if (dataFrom && dataFrom > startDate) {
		startDate = dataFrom;
		clamped = true;
	}
	if (!dataFrom || startDate >= last) return null;
	return {
		startDate,
		endDate: last,
		cashflowFrom: addDays(startDate, 1),
		clamped,
	};
}

export type GrowthBreakdownInput = {
	/**
	 * Net worth without the broker depot, at the start and the end. The depot
	 * has no value history (its snapshot is an observation of now), so it is
	 * handled on its own below rather than appearing only at one end.
	 */
	startNetWorthMinor: number;
	endNetWorthMinor: number;
	/** Income minus spending over the window, by the cashflow report's rules. */
	savingMinor: number;
	/** Value changes of assets already on the balance sheet (`assetRevaluationMinor`). */
	revaluationMinor: number;
	/** Null without a depot. A value is null where it is not known. */
	depot: {
		startMinor: number | null;
		endMinor: number | null;
		/** Deposits minus withdrawals into the depot within the window. */
		netDepositsMinor: number;
	} | null;
};

export type GrowthBreakdown = {
	/** The change the three parts add up to. */
	totalMinor: number;
	/** "Eigene Sparleistung". */
	savingMinor: number;
	/** "Markt & Bewertung": depot beyond its deposits plus asset revaluations. */
	marketMinor: number;
	/** "Sonstiges": the remainder, never forced to zero. */
	otherMinor: number;
	/**
	 * `included`: the depot's value is known at both ends, so its price
	 * movement is in `marketMinor`. `excluded`: a value is missing, so the
	 * depot counts with what was paid in and out, and its prices are left out
	 * of both the total and the market part. `none`: no depot.
	 */
	depot: "included" | "excluded" | "none";
};

/**
 * Splits the change in net worth into what the owner saved, what markets and
 * valuations did, and the rest.
 *
 * - Saving is the cashflow report's net: booked income minus booked spending,
 *   internal transfers and transfer-kind categories left out.
 * - Market is the depot's change beyond the money moved into it, plus the
 *   revaluation of assets that were already on the books.
 * - Other is whatever is left: debt repaid, receivables, accounts or assets
 *   recorded for the first time, balances without bookings, and bookings
 *   whose category does not match what they are.
 *
 * A bank → depot transfer is neither saving nor market by itself: the bank
 * leg is a transfer (not in saving), the depot leg is a deposit (subtracted
 * from the depot's change), and net worth does not move.
 */
export function growthBreakdown(input: GrowthBreakdownInput): GrowthBreakdown {
	const depot = input.depot;
	const known =
		depot !== null && depot.startMinor !== null && depot.endMinor !== null;
	const depotChange = depot
		? known
			? (depot.endMinor as number) - (depot.startMinor as number)
			: depot.netDepositsMinor
		: 0;
	const depotMarket = depot && known ? depotChange - depot.netDepositsMinor : 0;
	const totalMinor =
		input.endNetWorthMinor - input.startNetWorthMinor + depotChange;
	const marketMinor = input.revaluationMinor + depotMarket;
	return {
		totalMinor,
		savingMinor: input.savingMinor,
		marketMinor,
		otherMinor: totalMinor - input.savingMinor - marketMinor,
		depot: depot === null ? "none" : known ? "included" : "excluded",
	};
}

export type ValuedAsset = {
	/** Valuations in base currency, any order. */
	valuations: readonly { date: string; valueMinor: number }[];
	/** Whether net worth counts the asset at the start and at the end. */
	countedAtStart: boolean;
	countedAtEnd: boolean;
	/** Set when the asset left the balance sheet inside the window. */
	disposedAt: string | null;
};

/**
 * How much assets were revalued inside the window. Only change counts: the
 * first recording of an asset is the price paid or an existing thing noted
 * down, not a gain, so an asset that enters inside the window starts from its
 * first valuation there. An asset sold inside the window ends at its last
 * valuation before the sale; the sale itself is not a revaluation.
 */
export function assetRevaluationMinor(
	assets: readonly ValuedAsset[],
	startDate: string,
	endDate: string,
): number {
	let total = 0;
	for (const asset of assets) {
		const sorted = [...asset.valuations].sort((a, b) =>
			a.date.localeCompare(b.date),
		);
		const at = (date: string, inclusive: boolean) => {
			let found: number | null = null;
			for (const row of sorted)
				if (inclusive ? row.date <= date : row.date < date)
					found = row.valueMinor;
			return found;
		};
		const base = asset.countedAtStart
			? at(startDate, true)
			: (sorted.find((row) => row.date > startDate && row.date <= endDate)
					?.valueMinor ?? null);
		const leftInside =
			asset.disposedAt !== null &&
			asset.disposedAt > startDate &&
			asset.disposedAt <= endDate;
		const end = asset.countedAtEnd
			? at(endDate, true)
			: leftInside
				? at(asset.disposedAt as string, false)
				: null;
		if (base === null || end === null) continue;
		total += end - base;
	}
	return total;
}

/**
 * Deposits minus withdrawals in broker activity, as a signed amount. The
 * provider's sign is not relied on: a deposit adds its magnitude, a
 * withdrawal subtracts it. Cancelled or rejected rows moved nothing.
 */
export function netBrokerDepositsMinor(
	rows: readonly {
		date: string;
		kind: string;
		status: string;
		amountMinor: number;
	}[],
	from: string,
	to: string,
): number {
	let total = 0;
	for (const row of rows) {
		if (row.date < from || row.date > to) continue;
		if (/cancel|reject|fail|storn/i.test(row.status)) continue;
		if (row.kind === "deposit") total += Math.abs(row.amountMinor);
		else if (row.kind === "withdrawal") total -= Math.abs(row.amountMinor);
	}
	return total;
}

/* ── Savings streak ─────────────────────────────────────────────────────── */

export type SavingsStreak = {
	/** Consecutive full months, newest first, with income above spending. */
	months: number;
	/** First month ("YYYY-MM") of the streak; null for a streak of 0. */
	since: string | null;
	/** Full months on record; 0 means there is nothing to count yet. */
	fullMonths: number;
};

/**
 * Counts back from the last full calendar month while income exceeded
 * spending. The running month never counts, and neither does the month of the
 * first booking unless it began on the 1st: half a month of income against
 * half a month of spending says nothing. The same full-month rule as the
 * reserve basis (`monthlyExpenseBasis`).
 */
export function savingsStreak(input: {
	/** Cashflow months ("YYYY-MM") with the report's net (income − spending). */
	months: readonly { month: string; netMinor: number }[];
	firstBookingDate: string | null;
	today: string;
}): SavingsStreak {
	const first = input.firstBookingDate;
	if (!first) return { months: 0, since: null, fullMonths: 0 };
	const current = input.today.slice(0, 7);
	const firstMonth = first.slice(0, 7);
	const full = input.months
		.filter(
			(row) =>
				row.month < current &&
				(row.month > firstMonth ||
					(row.month === firstMonth && first.endsWith("-01"))),
		)
		.sort((a, b) => b.month.localeCompare(a.month));
	const lastFull = addMonths(`${current}-01`, -1).slice(0, 7);
	let count = 0;
	let since: string | null = null;
	if (full[0]?.month !== lastFull)
		return { months: 0, since: null, fullMonths: full.length };
	for (const [index, row] of full.entries()) {
		// A gap in the series is a month without data, never a saved one.
		const expected = addMonths(`${full[0].month}-01`, -index).slice(0, 7);
		if (row.month !== expected || row.netMinor <= 0) break;
		count += 1;
		since = row.month;
	}
	return { months: count, since, fullMonths: full.length };
}

/* ── Reserve pot ────────────────────────────────────────────────────────── */

export type ReservePot = {
	/** Liquid bank cash, the same figure "Anlegen" starts from. */
	bankCashMinor: number;
	/** `requiredReserve`, never a second formula. */
	reserveMinor: number;
	full: boolean;
	/** Whole percent, rounded down so it reads 100 only when full. */
	percent: number;
	/** The reserve's own sentence on how the figure came about. */
	note: string;
};

/** Null when there is no reserve to fill: no basis or zero. */
export function reservePot(
	bankCashMinor: number,
	reserve: { reserveMinor: number | null; note: string },
): ReservePot | null {
	if (reserve.reserveMinor === null || reserve.reserveMinor <= 0) return null;
	const cash = Math.max(0, bankCashMinor);
	const full = cash >= reserve.reserveMinor;
	return {
		bankCashMinor: cash,
		reserveMinor: reserve.reserveMinor,
		full,
		percent: full
			? 100
			: Math.min(99, Math.floor((cash / reserve.reserveMinor) * 100)),
		note: reserve.note,
	};
}

/** "voll" or "65 %": the pot's state in one word. */
export function reservePotState(pot: ReservePot): string {
	return pot.full ? "voll" : `${pot.percent}\u00a0%`;
}

/** "Reserve: 3.200,00 € von 4.917,00 € — 65 %"; the pot as one line. */
export function reservePotText(pot: ReservePot, currency: string): string {
	const money = (minor: number) => formatMoney(minor, currency);
	// A full pot shows the reserve twice rather than the surplus: what lies
	// above it is "Anlegen"'s business, not the pot's.
	const filled = Math.min(pot.bankCashMinor, pot.reserveMinor);
	return `Reserve: ${money(filled)} von ${money(pot.reserveMinor)} — ${reservePotState(pot)}`;
}
