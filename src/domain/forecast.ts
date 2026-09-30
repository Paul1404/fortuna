import { addDays, daysBetween } from "./dates";
import { type Frequency, occurrencesBetween } from "./recurring";

// Cashflow forecast. Projects liquid balance day by day from today over a
// horizon, layering three kinds of items with explicit confidence:
//   scheduled  - known future transactions (pending or user-entered), certain
//   recurring  - active recurring payments projected by cadence, estimated
//   baseline   - average irregular daily spend from history, uncertain
// The projection reports each layer separately so the UI never presents an
// estimate as a fact.

export type ForecastRecurring = {
	id: string;
	name: string;
	amountMinor: number; // signed
	frequency: Frequency;
	intervalDays: number;
	nextExpected: string;
	/**
	 * Day of the month a month-based cadence is really due on. `nextExpected`
	 * may be a clamped date — 30.06. for a payment due on the 31st — and
	 * without this every later month stayed a day early.
	 */
	typicalDay?: number | null;
	isActive: boolean;
	categoryName?: string | null;
	/**
	 * Last day this payment is still due, from the contract behind it. A
	 * cancelled contract keeps costing money until its end date and then stops;
	 * the forecast used to run every recurring payment forever, so a contract
	 * cancelled for December still drained the balance in the following June.
	 */
	endsAfter?: string | null;
};

export type ScheduledItem = {
	id: string;
	name: string;
	date: string;
	amountMinor: number;
	/** Set when this booking is already the occurrence of a recurring payment. */
	recurringPaymentId?: string | null;
};

export type ForecastInput = {
	startDate: string;
	horizonDays: number;
	openingBalanceMinor: number;
	recurring: readonly ForecastRecurring[];
	scheduled: readonly ScheduledItem[];
	/** Average daily net of irregular (non-recurring) transactions, signed. */
	irregularDailyNetMinor: number;
	/** Standard deviation of monthly irregular net, used for the band. */
	irregularMonthlyStdMinor?: number;
};

export type ForecastEvent = {
	date: string;
	name: string;
	amountMinor: number;
	kind: "scheduled" | "recurring";
	sourceId: string;
};

export type ForecastPoint = {
	date: string;
	scheduledOnlyMinor: number;
	withRecurringMinor: number;
	projectedMinor: number;
	lowMinor: number;
	highMinor: number;
};

export type ForecastResult = {
	points: ForecastPoint[];
	events: ForecastEvent[];
	endBalanceMinor: number;
	lowestPoint: ForecastPoint | null;
	recurringNetMinor: number;
	scheduledNetMinor: number;
	irregularNetMinor: number;
};

export function buildForecast(input: ForecastInput): ForecastResult {
	const end = addDays(input.startDate, input.horizonDays);
	const events: ForecastEvent[] = [];
	for (const s of input.scheduled) {
		if (s.date >= input.startDate && s.date <= end) {
			events.push({
				date: s.date,
				name: s.name,
				amountMinor: s.amountMinor,
				kind: "scheduled",
				sourceId: s.id,
			});
		}
	}
	// A pending booking already linked to a recurring payment *is* that
	// occurrence. Projecting both would count the same money twice.
	const bookedThrough = new Map<string, string>();
	for (const s of input.scheduled) {
		if (!s.recurringPaymentId) continue;
		const seen = bookedThrough.get(s.recurringPaymentId);
		if (!seen || s.date > seen) bookedThrough.set(s.recurringPaymentId, s.date);
	}
	for (const r of input.recurring) {
		if (!r.isActive) continue;
		const alreadyBookedThrough = bookedThrough.get(r.id);
		// An overdue item is still expected, so it is placed at the start of the
		// horizon. The cadence keeps its own anchor: re-anchoring on today would
		// move every later occurrence to today's day of the month.
		const dates = occurrencesBetween(
			r.nextExpected,
			r.frequency,
			r.intervalDays,
			input.startDate,
			end,
			400,
			r.typicalDay,
		)
			.filter((date) => !alreadyBookedThrough || date > alreadyBookedThrough)
			.filter((date) => !r.endsAfter || date <= r.endsAfter);
		// An item overdue by a whole number of periods already lands on the first
		// day of the horizon, so adding the catch-up too would charge it twice on
		// exactly the day the lowest point is most sensitive to.
		if (
			r.nextExpected < input.startDate &&
			!(alreadyBookedThrough && alreadyBookedThrough >= r.nextExpected) &&
			dates[0] !== input.startDate &&
			// Nothing to catch up on once the contract behind it has run out.
			(!r.endsAfter || r.endsAfter >= input.startDate)
		) {
			dates.unshift(input.startDate);
		}
		for (const date of dates) {
			events.push({
				date,
				name: r.name,
				amountMinor: r.amountMinor,
				kind: "recurring",
				sourceId: r.id,
			});
		}
	}
	events.sort(
		(a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
	);

	const byDate = new Map<string, { scheduled: number; recurring: number }>();
	for (const e of events) {
		const bucket = byDate.get(e.date) ?? { scheduled: 0, recurring: 0 };
		if (e.kind === "scheduled") bucket.scheduled += e.amountMinor;
		else bucket.recurring += e.amountMinor;
		byDate.set(e.date, bucket);
	}

	const points: ForecastPoint[] = [];
	let scheduledOnly = input.openingBalanceMinor;
	let withRecurring = input.openingBalanceMinor;
	let projected = input.openingBalanceMinor;
	const dailyStd = (input.irregularMonthlyStdMinor ?? 0) / 30.44;
	let lowest: ForecastPoint | null = null;
	for (let day = 0; day <= input.horizonDays; day++) {
		const date = addDays(input.startDate, day);
		const bucket = byDate.get(date);
		if (bucket) {
			scheduledOnly += bucket.scheduled;
			withRecurring += bucket.scheduled + bucket.recurring;
			projected += bucket.scheduled + bucket.recurring;
		}
		if (day > 0) {
			projected += input.irregularDailyNetMinor;
		}
		// Uncertainty grows with the square root of elapsed days (random walk).
		const band = Math.round(
			dailyStd * Math.sqrt(day) * 1.5 +
				Math.abs(input.irregularDailyNetMinor) * day * 0.25,
		);
		const point: ForecastPoint = {
			date,
			scheduledOnlyMinor: Math.round(scheduledOnly),
			withRecurringMinor: Math.round(withRecurring),
			projectedMinor: Math.round(projected),
			lowMinor: Math.round(projected - band),
			highMinor: Math.round(projected + band),
		};
		points.push(point);
		if (!lowest || point.projectedMinor < lowest.projectedMinor) lowest = point;
	}
	const recurringNetMinor = events
		.filter((e) => e.kind === "recurring")
		.reduce((s, e) => s + e.amountMinor, 0);
	const scheduledNetMinor = events
		.filter((e) => e.kind === "scheduled")
		.reduce((s, e) => s + e.amountMinor, 0);
	return {
		points,
		events,
		endBalanceMinor:
			points[points.length - 1]?.projectedMinor ?? input.openingBalanceMinor,
		lowestPoint: lowest,
		recurringNetMinor,
		scheduledNetMinor,
		irregularNetMinor: Math.round(
			input.irregularDailyNetMinor * input.horizonDays,
		),
	};
}

/** Daily net of irregular spending from a window of history. */
/**
 * Average daily net of the bookings no recurring payment or contract already
 * projects. It follows the cashflow report's definition of spending: paired
 * transfers and categories of kind `transfer` are money moved, not money
 * spent. Counting them made a deposit to the broker look like consumption,
 * and the capital advice then kept the depot's cash back for a dip that was
 * only the owner's own investing.
 *
 * The average runs over the days that have data, not the whole window: a bank
 * connected last week reports about 90 days, and dividing by six months
 * spread that history over months nothing was recorded in.
 */
export function irregularDailyNet(
	txs: readonly {
		bookingDate: string;
		amountMinor: number;
		recurringPaymentId?: string | null;
		transferGroupId?: string | null;
		categoryKind?: string | null;
	}[],
	from: string,
	to: string,
): { dailyNetMinor: number; monthlyStdMinor: number } {
	let firstDate: string | null = null;
	for (const tx of txs)
		if (
			tx.bookingDate >= from &&
			tx.bookingDate <= to &&
			(!firstDate || tx.bookingDate < firstDate)
		)
			firstDate = tx.bookingDate;
	const days = Math.max(1, daysBetween(firstDate ?? from, to) + 1);
	const monthly = new Map<string, number>();
	let total = 0;
	for (const tx of txs) {
		if (tx.bookingDate < from || tx.bookingDate > to) continue;
		if (tx.recurringPaymentId || tx.transferGroupId) continue;
		if (tx.categoryKind === "transfer") continue;
		total += tx.amountMinor;
		const m = tx.bookingDate.slice(0, 7);
		monthly.set(m, (monthly.get(m) ?? 0) + tx.amountMinor);
	}
	const values = Array.from(monthly.values());
	const mean = values.length
		? values.reduce((s, v) => s + v, 0) / values.length
		: 0;
	const variance =
		values.length > 1
			? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1)
			: 0;
	return { dailyNetMinor: total / days, monthlyStdMinor: Math.sqrt(variance) };
}
