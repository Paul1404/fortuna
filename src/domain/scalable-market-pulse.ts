export type PulseHolding = {
	isin: string;
	name: string;
	quantity: number;
	currency: string;
	quotedValueMinor: number | null;
	reportedValueMinor: number | null;
	quoteAt: Date | null;
	quoteOutdated: boolean;
};

export type BaselineHolding = {
	isin: string;
	quantity: number;
	currency: string;
	valueMinor: number | null;
	valuationAt: Date | null;
	valuationSource: string | null;
};

/** A quote overlay is valid only for the exact booked snapshot it was derived from. */
export function pulseMatchesConfirmed(
	pulse: { confirmedNetWorthMinor: number | null } | null | undefined,
	confirmedNetWorthMinor: number,
): boolean {
	return pulse?.confirmedNetWorthMinor === confirmedNetWorthMinor;
}

/** Keep the opening count-up and never apply a quote to a different snapshot. */
export function marketDisplayTarget(
	confirmedMinor: number,
	quote: { baselineMinor: number; valueMinor: number } | null,
	ready: boolean,
): number {
	return ready && quote?.baselineMinor === confirmedMinor
		? quote.valueMinor
		: confirmedMinor;
}

/**
 * A depot figure moved by the quotes the pulse saw, or the booked figure
 * unchanged. The overlay applies only to the snapshot it was derived from
 * (`matches`), only in the figure's own currency, and never rewrites what is
 * stored: it is what the page shows between two syncs.
 */
export function depotIndicative(
	confirmedMinor: number | null,
	currency: string,
	moves: readonly { deltaMinor: number; currency: string }[],
	matches: boolean,
): number | null {
	if (confirmedMinor === null || !matches) return confirmedMinor;
	let delta = 0;
	for (const move of moves) {
		if (move.currency !== currency) return confirmedMinor;
		delta += move.deltaMinor;
	}
	return confirmedMinor + delta;
}

/** Only unchanged, priced quantities are comparable. A trade is not a price move. */
export function computeMarketPulse(
	baseline: readonly BaselineHolding[],
	latest: readonly PulseHolding[],
	now: Date,
) {
	const byIsin = new Map(baseline.map((holding) => [holding.isin, holding]));
	const movers: Array<{
		isin: string;
		name: string;
		deltaMinor: number;
		currency: string;
	}> = [];
	let skipped = 0;
	let latestQuoteAt: Date | null = null;
	for (const holding of latest) {
		const old = byIsin.get(holding.isin);
		const at = holding.quoteAt;
		if (
			!old ||
			old.quantity !== holding.quantity ||
			old.currency !== holding.currency ||
			old.valueMinor === null ||
			!["scalable_valuation", "scalable_quote"].includes(
				old.valuationSource ?? "",
			) ||
			holding.quotedValueMinor === null ||
			holding.quoteOutdated ||
			!at ||
			at.getTime() > now.getTime() + 60_000 ||
			now.getTime() - at.getTime() > 30 * 60_000 ||
			(old.valuationAt && at.getTime() < old.valuationAt.getTime() - 5 * 60_000)
		) {
			skipped++;
			continue;
		}
		if (!latestQuoteAt || at > latestQuoteAt) latestQuoteAt = at;
		movers.push({
			isin: holding.isin,
			name: holding.name,
			deltaMinor: holding.quotedValueMinor - old.valueMinor,
			currency: holding.currency,
		});
	}
	for (const holding of baseline)
		if (!latest.some((current) => current.isin === holding.isin)) skipped++;
	return { movers, skipped, latestQuoteAt };
}
