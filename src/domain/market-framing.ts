/**
 * What the net-worth hero puts beside the ticking figure — the owner's
 * decision of 28.09.2026. Watching a portfolio fall in one-second steps
 * invites the short view; on a down day the hero therefore frames the figure
 * against a longer one (a year ago, or the depot against what was paid for
 * it). On an up or flat day nothing changes. The ticker itself keeps moving
 * and keeps its colour: this is a quieter label, never an alarm.
 */

export type PulseReading =
	| {
			status: string;
			confirmedNetWorthMinor: number | null;
			indicativeNetWorthMinor: number | null;
	  }
	| null
	| undefined;

/**
 * A down day, precisely: the market pulse has a real reading
 * (`status = available`) computed against the very snapshot on screen
 * (`confirmedNetWorthMinor` equals the booked net worth shown), and that
 * reading, `indicativeNetWorthMinor`, is below it. The day's baseline is thus
 * the last confirmed Scalable snapshot the quotes are compared with — the
 * valuation booked by the latest sync, which the app runs on each visit —
 * not the simulated path between readings. No reading, a stale or failed one,
 * or a reading for another snapshot is not a down day.
 */
export function isDownDay(
	pulse: PulseReading,
	confirmedMinor: number,
): boolean {
	return (
		pulse?.status === "available" &&
		pulse.indicativeNetWorthMinor !== null &&
		pulse.confirmedNetWorthMinor === confirmedMinor &&
		pulse.indicativeNetWorthMinor < confirmedMinor
	);
}

export type DepotAgainstCost = { valueMinor: number; costBasisMinor: number };

/**
 * The depot's value against its cost basis, moved by the pulse's quotes,
 * or null when that comparison would be a guess: any position without a
 * cost basis, without a value or in another currency than the base makes
 * the whole comparison unavailable rather than partial.
 */
export function depotAgainstCost(
	positions: readonly {
		accountId: string;
		isin: string | null;
		currency: string;
		valueMinor: number | null;
		costBasisMinor: number | null;
	}[],
	/** The pulse's quote moves; they belong to one depot account only. */
	moves: {
		accountId: string;
		positions: readonly {
			isin: string;
			deltaMinor: number;
			currency: string;
		}[];
	} | null,
	baseCurrency: string,
): DepotAgainstCost | null {
	if (positions.length === 0) return null;
	let valueMinor = 0;
	let costBasisMinor = 0;
	for (const position of positions) {
		if (
			position.currency !== baseCurrency ||
			position.valueMinor === null ||
			position.costBasisMinor === null ||
			position.costBasisMinor <= 0
		)
			return null;
		valueMinor += position.valueMinor;
		costBasisMinor += position.costBasisMinor;
		const move =
			moves?.accountId === position.accountId
				? moves.positions.find((entry) => entry.isin === position.isin)
				: undefined;
		if (move && move.currency === baseCurrency) valueMinor += move.deltaMinor;
	}
	return { valueMinor, costBasisMinor };
}

export type HeroFraming =
	/** As on any other day: the date under the figure. */
	| { kind: "today" }
	/** Net worth against the value a year ago (the history's first point). */
	| { kind: "year"; sinceDate: string; changeMinor: number }
	/** The depot against what was paid for it. */
	| { kind: "costBasis"; gainMinor: number };

/**
 * The hero's supporting line. Up or flat: unchanged. Down: the change
 * against a year ago when that comparison exists, otherwise the depot
 * against its cost basis, otherwise unchanged — never an invented figure.
 * `liveNetWorthMinor` is the real reading, not the ticking path, so the
 * label moves only with readings.
 */
export function heroFraming(input: {
	down: boolean;
	liveNetWorthMinor: number;
	yearAgo: { date: string; netWorthMinor: number } | null;
	depot: DepotAgainstCost | null;
}): HeroFraming {
	if (!input.down) return { kind: "today" };
	if (input.yearAgo)
		return {
			kind: "year",
			sinceDate: input.yearAgo.date,
			changeMinor: input.liveNetWorthMinor - input.yearAgo.netWorthMinor,
		};
	if (input.depot)
		return {
			kind: "costBasis",
			gainMinor: input.depot.valueMinor - input.depot.costBasisMinor,
		};
	return { kind: "today" };
}
