import { addMonths } from "./dates";

/**
 * "Ihr August in drei Sätzen": the month recap on Hr. Körner's desk.
 *
 * Every figure is computed from the cashflow report and the net-worth
 * history; the sentences are written from those figures by rule, never by a
 * model, so the same month always reads the same. The voice is his — dry,
 * sparing, a little Franconian — because the desk is his screen.
 */

export type RecapMonthFigures = {
	incomeMinor: number;
	/** Positive. */
	expenseMinor: number;
	netMinor: number;
	/** Bookings that count in the cashflow (no transfers, nothing pending). */
	transactionCount: number;
};

export type RecapObservation = {
	title: string;
	severity: "info" | "notable" | "review" | "urgent";
};

export type RecapInput = {
	/** `YYYY-MM`: the month the recap is about. */
	month: string;
	currency: string;
	/** The owner's first booked transaction, or null without any. */
	firstBookingDate: string | null;
	current: RecapMonthFigures;
	/**
	 * The month before, or null when the data does not cover it fully — an
	 * empty month before would make every month read as "much more".
	 */
	previous: Omit<RecapMonthFigures, "transactionCount"> | null;
	/** The month's largest spending category (top level), if any. */
	topCategory: { name: string; amountMinor: number } | null;
	/**
	 * Net worth at the end of the month before and of this month. Null when
	 * there is no history to compare. `excludesDepot`: a connected depot has
	 * no history, so both ends leave it out and the sentence must say so.
	 */
	netWorth: {
		startMinor: number;
		endMinor: number;
		excludesDepot: boolean;
	} | null;
	/** Observations Hr. Körner first made during the month, not dismissed. */
	observations: readonly RecapObservation[];
};

export type MonthlyRecap = {
	month: string;
	/** "August". */
	monthName: string;
	/** "Ihr August in drei Sätzen". */
	title: string;
	/** False when the month has too few bookings to say anything honest. */
	enoughData: boolean;
	sentences: string[];
	numbers: {
		incomeMinor: number;
		expenseMinor: number;
		netMinor: number;
		/** Net over income in basis points, null without income. */
		savingsRateBps: number | null;
		/** Spending against the month before; positive means more. */
		expenseChangeMinor: number | null;
		topCategory: { name: string; amountMinor: number } | null;
		netWorthChangeMinor: number | null;
		netWorthExcludesDepot: boolean;
		/** The most important observation of the month, by severity. */
		notable: string | null;
		observationCount: number;
	};
};

/** Fewer cashflow bookings than this and a month says nothing. */
export const RECAP_MIN_BOOKINGS = 5;
/** Data starting later than this into the month leaves it incomplete. */
const RECAP_MAX_LATE_START_DAYS = 3;
/** A change in spending below this share of it is "about the same". */
const SAME_SPENDING_BPS = 300;

const SEVERITY_RANK: Record<RecapObservation["severity"], number> = {
	urgent: 0,
	review: 1,
	notable: 2,
	info: 3,
};

export function germanMonthName(month: string): string {
	return new Intl.DateTimeFormat("de-DE", {
		month: "long",
		timeZone: "UTC",
	}).format(new Date(`${month}-01T00:00:00Z`));
}

/** Whole units with the currency: "4.210 €". Sentences are no ledger. */
function amount(minor: number, currency: string): string {
	const text = new Intl.NumberFormat("de-DE", {
		style: "currency",
		currency,
		minimumFractionDigits: 0,
		maximumFractionDigits: 0,
	}).format(Math.round(Math.abs(minor) / 100));
	return text;
}

function percent(bps: number): string {
	return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(
		Math.abs(bps) / 100,
	)} %`;
}

/** The month before `month`, as `YYYY-MM`. */
export function previousMonth(month: string): string {
	return addMonths(`${month}-01`, -1).slice(0, 7);
}

/** True when the data covers the whole month (it started by its first days). */
export function monthCovered(
	month: string,
	firstBookingDate: string | null,
): boolean {
	if (!firstBookingDate) return false;
	const latestStart = `${month}-${String(1 + RECAP_MAX_LATE_START_DAYS).padStart(2, "0")}`;
	return firstBookingDate <= latestStart;
}

export function composeMonthlyRecap(input: RecapInput): MonthlyRecap {
	const monthName = germanMonthName(input.month);
	const previousName = germanMonthName(previousMonth(input.month));
	const { current, currency } = input;
	const enoughData =
		monthCovered(input.month, input.firstBookingDate) &&
		current.transactionCount >= RECAP_MIN_BOOKINGS;
	const savingsRateBps =
		current.incomeMinor > 0
			? Math.round((current.netMinor * 10_000) / current.incomeMinor)
			: null;
	const expenseChangeMinor = input.previous
		? current.expenseMinor - input.previous.expenseMinor
		: null;
	const netWorthChangeMinor = input.netWorth
		? input.netWorth.endMinor - input.netWorth.startMinor
		: null;
	const ranked = [...input.observations].sort(
		(a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
	);
	const notable = ranked[0]?.title ?? null;
	const numbers: MonthlyRecap["numbers"] = {
		incomeMinor: current.incomeMinor,
		expenseMinor: current.expenseMinor,
		netMinor: current.netMinor,
		savingsRateBps,
		expenseChangeMinor,
		topCategory: input.topCategory,
		netWorthChangeMinor,
		netWorthExcludesDepot: input.netWorth?.excludesDepot ?? false,
		notable,
		observationCount: input.observations.length,
	};
	const base = {
		month: input.month,
		monthName,
		title: `Ihr ${monthName} in drei Sätzen`,
	};

	if (!enoughData)
		return {
			...base,
			enoughData: false,
			sentences: [
				`Für ${monthName} liegen zu wenige Buchungen vor.`,
				"Aus dem bisschen eine Bilanz zu machen, wär geraten, und geraten wird hier nicht.",
				"Nächsten Monat schau ich wieder drauf.",
			],
			numbers,
		};

	// 1. What came in, what went out, what stayed.
	const first =
		current.netMinor >= 0
			? `Im ${monthName} kamen ${amount(current.incomeMinor, currency)} herein und ${amount(current.expenseMinor, currency)} gingen hinaus, übrig blieben ${amount(current.netMinor, currency)}${savingsRateBps !== null && savingsRateBps > 0 ? ` – ${percent(savingsRateBps)} vom Einkommen` : ""}.`
			: `Im ${monthName} gingen ${amount(current.expenseMinor, currency)} hinaus, herein kamen nur ${amount(current.incomeMinor, currency)}: ${amount(current.netMinor, currency)} mehr ausgegeben als eingenommen.`;

	// 2. Where most of it went, and against the month before.
	const top = input.topCategory;
	const where = top
		? top.name === "Nicht kategorisiert"
			? `Der größte Posten ist noch nicht zugeordnet (${amount(top.amountMinor, currency)})`
			: `Am meisten ging für ${top.name} weg (${amount(top.amountMinor, currency)})`
		: "Ausgaben nach Kategorie gab es keine";
	const change =
		expenseChangeMinor === null
			? `, einen Vergleich mit ${previousName} gibt es noch nicht.`
			: input.previous &&
					Math.abs(expenseChangeMinor) * 10_000 <
						input.previous.expenseMinor * SAME_SPENDING_BPS
				? `, insgesamt ungefähr so viel wie im ${previousName}.`
				: expenseChangeMinor > 0
					? `, insgesamt ${amount(expenseChangeMinor, currency)} mehr als im ${previousName}.`
					: `, insgesamt ${amount(expenseChangeMinor, currency)} weniger als im ${previousName}.`;
	const second = `${where}${change}`;

	// 3. Net worth, and whatever he noticed.
	const worth =
		netWorthChangeMinor === null
			? null
			: `${input.netWorth?.excludesDepot ? "Das Vermögen ohne Depot" : "Das Vermögen"} ${
					netWorthChangeMinor === 0
						? "blieb gleich"
						: netWorthChangeMinor > 0
							? `wuchs um ${amount(netWorthChangeMinor, currency)}`
							: `sank um ${amount(netWorthChangeMinor, currency)}`
				}`;
	const noticed = notable
		? `aufgefallen ist mir: ${notable}`
		: current.netMinor >= 0
			? "sonst ist mir nix aufgefallen, passt scho"
			: "sonst ist mir nix aufgefallen";
	const third = worth
		? `${worth}; ${noticed}.`
		: `${noticed.charAt(0).toUpperCase()}${noticed.slice(1)}.`;

	return {
		...base,
		enoughData: true,
		sentences: [first, second, third],
		numbers,
	};
}
