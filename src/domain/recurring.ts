import {
	addDays,
	addMonths,
	daysBetween,
	daysInMonth,
	parseIso,
	toIsoDate,
} from "./dates";
import { merchantKey, namesCounterparty, titleCase } from "./normalize";

// Recurring-payment detection. Groups transactions by merchant key and
// direction, then looks at the gaps between consecutive bookings. A group is
// recurring when at least `minOccurrences` bookings fall into a consistent
// cadence and the amounts stay within tolerance of their median.

export type Frequency =
	| "weekly"
	| "biweekly"
	| "monthly"
	| "bimonthly"
	| "quarterly"
	| "semiannual"
	| "yearly"
	| "custom";

export type RecurringInputTx = {
	id: string;
	accountId: string;
	bookingDate: string;
	amountMinor: number;
	currency: string;
	description: string;
	merchantName?: string | null;
	counterpartyName?: string | null;
	categoryId?: string | null;
	transferGroupId?: string | null;
};

/**
 * A lasting change in what a recurring payment costs.
 *
 * Two problems, one cause. The owner is never told that Telekom quietly went
 * from 49,95 € to 52,30 €, and the forecast takes the median across every
 * booking — which after a rise sits between the old price and the new one and
 * projects an amount that was never charged and never will be.
 */
export type PriceChange = {
	fromMinor: number;
	toMinor: number;
	/** First booking at the new level. */
	since: string;
	/** Change per year at the payment's own cadence. */
	annualDifferenceMinor: number;
};

/**
 * Splits amounts into the level being charged now and the level before it.
 *
 * Walks back from the newest booking while the amount stays within tolerance,
 * which is the run currently in force. Anything older is the previous level,
 * and it only counts as a change when that older part is itself consistent —
 * otherwise this is noise, not a price.
 */
export function amountLevels(
	amounts: readonly number[],
	// Tight on purpose. A fixed price repeats to the cent, so the wobble worth
	// absorbing is small — and a 5 % window would swallow the 4,7 % rise this
	// exists to catch.
	tolerance = 0.02,
): { currentMinor: number; previousMinor: number | null; changedAt: number } {
	const near = (value: number, level: number) =>
		Math.abs(value - level) <= Math.max(level * tolerance, 30);
	const newest = amounts[amounts.length - 1];
	let start = amounts.length - 1;
	while (start > 0 && near(amounts[start - 1], newest)) start -= 1;
	const current = median(amounts.slice(start));
	const older = amounts.slice(0, start);
	// One booking at the old price could be a one-off correction, and two
	// levels need at least two bookings each to be levels at all.
	if (older.length < 2 || amounts.length - start < 2)
		return { currentMinor: current, previousMinor: null, changedAt: start };
	const previous = median(older);
	const olderConsistent =
		older.filter((value) => near(value, previous)).length / older.length >= 0.7;
	if (!olderConsistent || near(previous, current))
		return { currentMinor: current, previousMinor: null, changedAt: start };
	return { currentMinor: current, previousMinor: previous, changedAt: start };
}

export type DetectedRecurring = {
	matchKey: string;
	name: string;
	accountId: string;
	direction: "inflow" | "outflow";
	currency: string;
	expectedAmountMinor: number;
	frequency: Frequency;
	intervalDays: number;
	typicalDay: number;
	windowDays: number;
	transactionIds: string[];
	lastOccurrence: string;
	nextExpected: string;
	categoryId: string | null;
	confidence: number;
	/** Set when the amount moved to a new level and stayed there. */
	priceChange: PriceChange | null;
};

const CADENCES: { frequency: Frequency; days: number; tolerance: number }[] = [
	{ frequency: "weekly", days: 7, tolerance: 2 },
	{ frequency: "biweekly", days: 14, tolerance: 3 },
	{ frequency: "monthly", days: 30.44, tolerance: 6 },
	{ frequency: "bimonthly", days: 60.9, tolerance: 8 },
	{ frequency: "quarterly", days: 91.3, tolerance: 10 },
	{ frequency: "semiannual", days: 182.6, tolerance: 14 },
	{ frequency: "yearly", days: 365.25, tolerance: 20 },
];

export function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function classifyInterval(days: number): {
	frequency: Frequency;
	intervalDays: number;
} {
	for (const c of CADENCES) {
		if (Math.abs(days - c.days) <= c.tolerance) {
			return { frequency: c.frequency, intervalDays: Math.round(c.days) };
		}
	}
	return { frequency: "custom", intervalDays: Math.round(days) };
}

const MONTHS_PER_PERIOD: Partial<Record<Frequency, number>> = {
	monthly: 1,
	bimonthly: 2,
	quarterly: 3,
	semiannual: 6,
	yearly: 12,
};

/**
 * The next due date after `last`.
 *
 * `typicalDay` is the day of the month the payment is really due on. A
 * booking on the last day of a short month may be that day clamped — rent due
 * on the 31st is booked on 30 April — and stepping a month from the clamped
 * date would put May on the 30th and keep it there. Only a booking that sits
 * on its month's last day, earlier than the typical day, is treated as
 * clamped; any other booking keeps its own day.
 */
export function nextExpectedDate(
	last: string,
	frequency: Frequency,
	intervalDays: number,
	typicalDay?: number | null,
): string {
	const months = MONTHS_PER_PERIOD[frequency];
	if (!months) return addDays(last, intervalDays);
	const next = addMonths(last, months);
	const day = parseIso(last).getUTCDate();
	if (!typicalDay || typicalDay <= day || day !== daysInMonth(last))
		return next;
	const target = Math.min(typicalDay, daysInMonth(next));
	return `${next.slice(0, 8)}${String(target).padStart(2, "0")}`;
}

export type DetectOptions = {
	minOccurrences?: number;
	amountTolerance?: number; // relative, e.g. 0.15 = 15%
	now?: string;
};

export function detectRecurring(
	txs: readonly RecurringInputTx[],
	options: DetectOptions = {},
): DetectedRecurring[] {
	const minOccurrences = options.minOccurrences ?? 3;
	const amountTolerance = options.amountTolerance ?? 0.2;
	const groups = new Map<string, RecurringInputTx[]>();
	for (const tx of txs) {
		if (tx.transferGroupId) continue;
		if (tx.amountMinor === 0) continue;
		// A placeholder text with no counterparty names no merchant, and
		// grouping by it invents one.
		if (
			!namesCounterparty(tx.merchantName, tx.counterpartyName, tx.description)
		)
			continue;
		const key = `${tx.accountId}|${tx.amountMinor < 0 ? "out" : "in"}|${tx.currency}|${merchantKey(
			tx.merchantName ?? tx.counterpartyName,
			tx.description,
		)}`;
		const list = groups.get(key) ?? [];
		list.push(tx);
		groups.set(key, list);
	}
	const results: DetectedRecurring[] = [];
	// One merchant can bill for two different things: this owner's Telekom
	// group held a mobile contract around 35 € and a TV subscription at exactly
	// 10 €, both monthly and both clean on their own. Together the amounts look
	// erratic and the whole group was discarded, losing two real payments. When
	// a merchant group fails, it is retried split by what the purpose says,
	// which is what tells the two apart — and that key stays stable across a
	// price change, unlike splitting on the amount would.
	const pending: [string, RecurringInputTx[]][] = [];
	for (const [key, list] of groups) {
		pending.push([key, list]);
		const byPurpose = new Map<string, RecurringInputTx[]>();
		for (const tx of list) {
			const purpose = merchantKey(null, tx.description) || "";
			const sub = byPurpose.get(purpose) ?? [];
			sub.push(tx);
			byPurpose.set(purpose, sub);
		}
		if (byPurpose.size > 1)
			for (const [purpose, sub] of byPurpose)
				if (sub.length >= minOccurrences)
					pending.push([`${key}#${purpose}`, sub]);
	}
	// A booking belongs to one payment only: the whole-merchant group is tried
	// first, and its parts only get what it did not take.
	const claimed = new Set<string>();
	for (const [key, all] of pending) {
		const list = all.filter((tx) => !claimed.has(tx.id));
		if (list.length < minOccurrences) continue;
		const sorted = [...list].sort((a, b) =>
			a.bookingDate.localeCompare(b.bookingDate),
		);
		// Keep one booking per calendar day per group (split payments collapse).
		const perDay = new Map<string, RecurringInputTx>();
		for (const tx of sorted) {
			const existing = perDay.get(tx.bookingDate);
			perDay.set(
				tx.bookingDate,
				existing
					? { ...existing, amountMinor: existing.amountMinor + tx.amountMinor }
					: tx,
			);
		}
		const occurrences = Array.from(perDay.values());
		if (occurrences.length < minOccurrences) continue;
		const amounts = occurrences.map((t) => Math.abs(t.amountMinor));
		const levels = amountLevels(amounts);
		// What it costs now, not the median across a price rise: after an
		// increase that median sits between the old price and the new one and
		// projects an amount that was never charged.
		const medianAmount = levels.currentMinor;
		const withinAmount = amounts.filter(
			(a) =>
				Math.abs(a - medianAmount) <=
				Math.max(medianAmount * amountTolerance, 200),
		).length;
		// A clean move to a new level is a price, not noise, so it passes the
		// consistency check that the spread would otherwise fail.
		if (withinAmount / amounts.length < 0.7 && levels.previousMinor === null)
			continue;
		const gaps: number[] = [];
		for (let i = 1; i < occurrences.length; i++) {
			gaps.push(
				daysBetween(occurrences[i - 1].bookingDate, occurrences[i].bookingDate),
			);
		}
		const medianGap = median(gaps);
		if (medianGap < 5) continue;
		const { frequency, intervalDays } = classifyInterval(medianGap);
		const cadence = CADENCES.find((c) => c.frequency === frequency);
		const tolerance = cadence
			? cadence.tolerance
			: Math.max(3, medianGap * 0.2);
		const consistentGaps = gaps.filter(
			(g) => Math.abs(g - medianGap) <= tolerance,
		).length;
		const gapConsistency = consistentGaps / gaps.length;
		if (gapConsistency < 0.6) continue;
		const last = occurrences[occurrences.length - 1];
		const days = occurrences.map((t) => parseIso(t.bookingDate).getUTCDate());
		const typicalDay = Math.round(median(days));
		const nextExpected = nextExpectedDate(
			last.bookingDate,
			frequency,
			intervalDays,
			typicalDay,
		);
		// A merchant split by purpose yields two payments that would otherwise
		// both read "Telekom Deutschland GmbH" and be impossible to tell apart.
		// The first words of the purpose say which is which.
		const merchant =
			last.merchantName || last.counterpartyName || last.description;
		const purposeWords = titleCase(merchantKey(null, last.description) || "")
			.split(" ")
			// A reference number says nothing about which payment this is.
			.filter((word) => word && !/\d/.test(word))
			.slice(0, 2)
			.join(" ");
		const name =
			key.includes("#") && last.merchantName && purposeWords
				? `${merchant} · ${purposeWords}`
				: merchant;
		const categoryCounts = new Map<string, number>();
		for (const t of occurrences) {
			if (t.categoryId)
				categoryCounts.set(
					t.categoryId,
					(categoryCounts.get(t.categoryId) ?? 0) + 1,
				);
		}
		const categoryId =
			Array.from(categoryCounts.entries()).sort(
				(a, b) => b[1] - a[1],
			)[0]?.[0] ?? null;
		for (const occurrence of occurrences) claimed.add(occurrence.id);
		results.push({
			matchKey: key,
			name: name.trim(),
			accountId: last.accountId,
			direction: last.amountMinor < 0 ? "outflow" : "inflow",
			currency: last.currency,
			expectedAmountMinor:
				Math.round(medianAmount) * (last.amountMinor < 0 ? -1 : 1),
			frequency,
			intervalDays,
			typicalDay,
			windowDays: Math.round(tolerance),
			transactionIds: occurrences.map((t) => t.id),
			priceChange:
				levels.previousMinor === null
					? null
					: {
							fromMinor: Math.round(levels.previousMinor),
							toMinor: Math.round(levels.currentMinor),
							since: occurrences[levels.changedAt].bookingDate,
							annualDifferenceMinor: Math.round(
								(levels.currentMinor - levels.previousMinor) *
									(365.2425 / Math.max(1, intervalDays)),
							),
						},
			lastOccurrence: last.bookingDate,
			nextExpected,
			categoryId,
			confidence:
				Math.round(
					((withinAmount / amounts.length + gapConsistency) / 2) * 100,
				) / 100,
		});
	}
	return results.sort(
		(a, b) => Math.abs(b.expectedAmountMinor) - Math.abs(a.expectedAmountMinor),
	);
}

/** Whether a recurring item is overdue relative to `now`. */
export function isOverdue(
	nextExpected: string,
	windowDays: number,
	now: string,
): boolean {
	return daysBetween(nextExpected, now) > windowDays;
}

/**
 * The day of the month a month-based cadence is really due on.
 *
 * `first` may itself be a clamped date: a payment due on the 31st whose next
 * occurrence is 30.06. carries 30 as its day. Only `typicalDay` knows the 31st,
 * and it is trusted exactly as `nextExpectedDate` trusts it — when `first`
 * sits on its month's last day and earlier than the typical day.
 */
function anchorDay(first: string, typicalDay?: number | null): number {
	const day = parseIso(first).getUTCDate();
	if (!typicalDay || typicalDay <= day || day !== daysInMonth(first))
		return day;
	return Math.min(typicalDay, 31);
}

/** Days between occurrences when a row carries no interval of its own. */
export function defaultIntervalDays(frequency: Frequency): number {
	const cadence = CADENCES.find((c) => c.frequency === frequency);
	return cadence ? Math.round(cadence.days) : 30;
}

export function occurrencesBetween(
	first: string,
	frequency: Frequency,
	intervalDays: number,
	from: string,
	to: string,
	limit = 400,
	typicalDay?: number | null,
): string[] {
	const out: string[] = [];
	// Month-based cadences are counted from the anchor, not from the previous
	// clamped date: stepping 31 Jan → 28 Feb → 28 Mar would lose the 31st for
	// good and project every later month three days early.
	const months = MONTHS_PER_PERIOD[frequency];
	if (months) {
		const day = anchorDay(first, typicalDay);
		const monthStart = `${first.slice(0, 8)}01`;
		for (let period = 0; period < limit; period++) {
			const month = addMonths(monthStart, period * months);
			const target = Math.min(day, daysInMonth(month));
			const date =
				period === 0
					? first
					: `${month.slice(0, 8)}${String(target).padStart(2, "0")}`;
			if (date > to) break;
			if (date >= from) out.push(date);
		}
		return out;
	}
	let cursor = first;
	let guard = 0;
	while (cursor <= to && guard++ < limit) {
		if (cursor >= from) out.push(cursor);
		cursor = nextExpectedDate(cursor, frequency, intervalDays);
	}
	return out;
}

export function monthlyEquivalentMinor(
	amountMinor: number,
	frequency: Frequency,
	intervalDays: number,
): number {
	switch (frequency) {
		case "weekly":
			return Math.round((amountMinor * 52) / 12);
		case "biweekly":
			return Math.round((amountMinor * 26) / 12);
		case "monthly":
			return amountMinor;
		case "bimonthly":
			return Math.round(amountMinor / 2);
		case "quarterly":
			return Math.round(amountMinor / 3);
		case "semiannual":
			return Math.round(amountMinor / 6);
		case "yearly":
			return Math.round(amountMinor / 12);
		default:
			return intervalDays > 0
				? Math.round((amountMinor * 30.44) / intervalDays)
				: amountMinor;
	}
}

export { toIsoDate };

/**
 * Whether an unlinked booking plausibly belongs to a recurring payment that
 * has no booking linked at all. A payment created by hand (or by Hr. Körner)
 * starts with none, and its bookings then sit in its category unconnected:
 * the payment looks as if it never happened and the forecast cannot learn
 * its dates. Same currency, same direction, the payment's account when it
 * names one, and an amount within 10 % (at least 1,00) of the expected one —
 * a category holds other merchants too, so the amount is what tells them
 * apart.
 */
export function matchesRecurringBooking(
	recurring: {
		direction: "inflow" | "outflow";
		expectedAmountMinor: number;
		currency: string;
		accountId: string | null;
	},
	booking: { amountMinor: number; currency: string; accountId: string },
): boolean {
	if (booking.currency !== recurring.currency) return false;
	if (recurring.accountId && booking.accountId !== recurring.accountId)
		return false;
	const outflow = booking.amountMinor < 0;
	if (outflow !== (recurring.direction === "outflow")) return false;
	const expected = Math.abs(recurring.expectedAmountMinor);
	const actual = Math.abs(booking.amountMinor);
	return (
		Math.abs(actual - expected) <= Math.max(100, Math.round(expected / 10))
	);
}

/** A recurring payment the owner entered by hand (it has no match key). */
export type ManualRecurring = {
	id: string;
	accountId: string | null;
	direction: "inflow" | "outflow";
	currency: string;
	expectedAmountMinor: number;
	frequency: Frequency;
	categoryId: string | null;
};

/**
 * The payment the owner already entered for what detection just found, if
 * any.
 *
 * Manual payments carry no match key, so detection could not see them and
 * added an automatic copy beside each — one premium on two rows, counted
 * twice on /fixed-costs and in the forecast — while the manual row itself
 * never received a booking and projected from a date nobody had checked.
 *
 * A manual payment that already holds one of the group's bookings is that
 * payment. Otherwise it must agree on direction, currency, account (when it
 * names one), cadence, category (when both have one) and amount, and be the
 * only one that does: an ambiguous match is left alone.
 */
export function manualPaymentFor(
	detected: Pick<
		DetectedRecurring,
		| "accountId"
		| "direction"
		| "currency"
		| "expectedAmountMinor"
		| "frequency"
		| "categoryId"
		| "transactionIds"
	>,
	manual: readonly ManualRecurring[],
	/** Booking id → the recurring payment it is linked to. */
	linkedTo: ReadonlyMap<string, string>,
): string | null {
	const manualIds = new Set(manual.map((row) => row.id));
	const owners = new Map<string, number>();
	for (const id of detected.transactionIds) {
		const owner = linkedTo.get(id);
		if (owner && manualIds.has(owner))
			owners.set(owner, (owners.get(owner) ?? 0) + 1);
	}
	const byOverlap = [...owners].sort((a, b) => b[1] - a[1]);
	if (byOverlap.length) return byOverlap[0][0];
	const matching = manual.filter(
		(row) =>
			row.direction === detected.direction &&
			row.frequency === detected.frequency &&
			(!row.categoryId ||
				!detected.categoryId ||
				row.categoryId === detected.categoryId) &&
			matchesRecurringBooking(row, {
				amountMinor: detected.expectedAmountMinor,
				currency: detected.currency,
				accountId: detected.accountId,
			}),
	);
	return matching.length === 1 ? matching[0].id : null;
}

/**
 * When a payment without a stored due date is expected next.
 *
 * The forecast used today, so a monthly premium due on the 15th was charged
 * on the day the forecast was read and then on that day of every month —
 * after this month's premium had already been paid. A monthly payment's
 * typical day says when it really falls due. Any other cadence keeps today:
 * which month a yearly premium belongs to is not known.
 */
export function fallbackNextExpected(
	today: string,
	frequency: Frequency,
	typicalDay: number | null | undefined,
): string {
	if (frequency !== "monthly" || !typicalDay) return today;
	const inMonth = (month: string) =>
		`${month.slice(0, 8)}${String(Math.min(typicalDay, daysInMonth(month))).padStart(2, "0")}`;
	const thisMonth = inMonth(today);
	return thisMonth >= today
		? thisMonth
		: inMonth(addMonths(`${today.slice(0, 8)}01`, 1));
}
