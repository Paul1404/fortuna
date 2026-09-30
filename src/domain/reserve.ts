import { formatMoney } from "./money";

/**
 * The one reserve rule, used by the desk, the "Anlegen" flow and
 * Hr. Körner's observations alike:
 *
 *   reserve = max(reserve months × monthly expenses, minimum reserve)
 *
 * Monthly expenses are only taken from the booking history once it covers
 * enough full months. Two weeks of bookings divided by a twelve-month window
 * once made the reserve look like "58 months" of spending; before that point
 * the recurring payments stand in for the average, and without those only
 * the owner's own minimum counts.
 *
 * The recurring payments are a floor, not an estimate: they leave out
 * everything that is not a fixed payment. Once one full month is on record,
 * the stand-in is the larger of the two, so a reserve is never set below
 * what full months have already been seen to cost. Full months cannot
 * repeat the "58 months" mistake; only a partial one divided as if whole can.
 */

/** Full calendar months of bookings before the average is trusted. */
export const MIN_HISTORY_MONTHS = 3;
/** The average never reaches further back than a year. */
const MAX_HISTORY_MONTHS = 12;

export type ExpenseBasis = {
	monthlyMinor: number;
	/** Where the monthly figure comes from. */
	/**
	 * `history` once enough full months are on record; `partial` for the
	 * average of fewer full months when it exceeds the recurring payments.
	 */
	source: "history" | "partial" | "recurring" | "none";
	/** Full calendar months with bookings, before the current one. */
	fullMonths: number;
};

/**
 * Average monthly spending from full months only: the month of the first
 * booking is partial unless it started on the 1st, and the running month is
 * never full.
 */
export function monthlyExpenseBasis(input: {
	/** Cashflow months ("YYYY-MM") with spending as a positive magnitude. */
	months: readonly { month: string; expenseMinor: number }[];
	/** Earliest booking of any account; null without bookings. */
	firstBookingDate: string | null;
	today: string;
	/** Monthly equivalent of active recurring outflows, as a magnitude. */
	recurringMonthlyMinor: number;
}): ExpenseBasis {
	const current = input.today.slice(0, 7);
	const first = input.firstBookingDate;
	const full = first
		? input.months
				.filter(
					(row) =>
						row.month < current &&
						(row.month > first.slice(0, 7) ||
							(row.month === first.slice(0, 7) && first.endsWith("-01"))),
				)
				.slice(-MAX_HISTORY_MONTHS)
		: [];
	if (full.length >= MIN_HISTORY_MONTHS) {
		const total = full.reduce((sum, row) => sum + row.expenseMinor, 0);
		return {
			monthlyMinor: Math.round(total / full.length),
			source: "history",
			fullMonths: full.length,
		};
	}
	const partial =
		full.length > 0
			? Math.round(
					full.reduce((sum, row) => sum + row.expenseMinor, 0) / full.length,
				)
			: 0;
	if (partial > input.recurringMonthlyMinor)
		return {
			monthlyMinor: partial,
			source: "partial",
			fullMonths: full.length,
		};
	if (input.recurringMonthlyMinor > 0)
		return {
			monthlyMinor: input.recurringMonthlyMinor,
			source: "recurring",
			fullMonths: full.length,
		};
	return { monthlyMinor: 0, source: "none", fullMonths: full.length };
}

export type Reserve = {
	/** Null without any basis: no spending known and no minimum set. */
	reserveMinor: number | null;
	reserveMonths: number;
	monthlyExpensesMinor: number;
	minimumReserveMinor: number | null;
	basis: ExpenseBasis["source"];
	/** Which term decided: the months or the owner's minimum. */
	binding: "months" | "minimum" | null;
	/** One German sentence saying how the figure came about. */
	note: string;
};

export function requiredReserve(input: {
	basis: ExpenseBasis;
	reserveMonths: number;
	/** In base currency; null when unset or entered in another currency. */
	minimumReserveMinor: number | null;
	currency: string;
}): Reserve {
	const money = (minor: number) => formatMoney(minor, input.currency);
	const months = Math.max(0, input.reserveMonths);
	const fromMonths =
		input.basis.source === "none"
			? null
			: Math.round(input.basis.monthlyMinor * months);
	const minimum =
		input.minimumReserveMinor !== null && input.minimumReserveMinor > 0
			? input.minimumReserveMinor
			: null;
	const base = {
		reserveMonths: months,
		monthlyExpensesMinor: input.basis.monthlyMinor,
		minimumReserveMinor: minimum,
		basis: input.basis.source,
	};
	if (fromMonths === null && minimum === null)
		return {
			...base,
			reserveMinor: null,
			binding: null,
			note: `Noch keine Grundlage: ${input.basis.fullMonths} von ${MIN_HISTORY_MONTHS} vollen Monaten Buchungen, keine festen Zahlungen und keine Mindestreserve.`,
		};
	const binding =
		fromMonths === null || (minimum !== null && minimum >= fromMonths)
			? "minimum"
			: "months";
	const reserveMinor = Math.max(fromMonths ?? 0, minimum ?? 0);
	const expenses =
		input.basis.source === "history"
			? `${months} Monatsausgaben à ${money(input.basis.monthlyMinor)} (Schnitt aus ${input.basis.fullMonths} vollen Monaten)`
			: input.basis.source === "partial"
				? `${months} Monatsausgaben à ${money(input.basis.monthlyMinor)} (Schnitt aus erst ${input.basis.fullMonths} von ${MIN_HISTORY_MONTHS} vollen Monaten, mehr als die festen Zahlungen)`
				: input.basis.source === "recurring"
					? `${months} Monate feste Zahlungen à ${money(input.basis.monthlyMinor)}, weil erst ${input.basis.fullMonths} von ${MIN_HISTORY_MONTHS} vollen Monaten Buchungen vorliegen`
					: null;
	const note =
		binding === "minimum"
			? expenses
				? `Ihre Mindestreserve; ${expenses} ergäben weniger.`
				: `Ihre Mindestreserve. Für einen Monatsschnitt fehlen noch ${MIN_HISTORY_MONTHS - input.basis.fullMonths} volle Monate Buchungen.`
			: `${expenses}.`;
	return { ...base, reserveMinor, binding, note };
}
