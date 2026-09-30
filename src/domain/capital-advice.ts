/**
 * "Anlegen": what free money is for, computed from one target split and the
 * reserve, nothing else. The waterfall, in this order:
 *
 * 1. The reserve (`requiredReserve` in `reserve.ts`) stays liquid.
 * 2. A dip the forecast already sees below the reserve stays liquid too.
 * 3. The cash share of the target split: liquid money is kept at the larger
 *    of the two above and that share of the whole portfolio, so the reserve
 *    counts towards the cash share rather than on top of it.
 * 4. The rest is bought by the gap of each class to its target, only into
 *    instruments already in the depot. An ISIN is never invented, by rule or
 *    by model; a class without a holding is named and its money stays put.
 *
 * Buys only. A sale is never proposed: rebalancing an overweight class is
 * done with new money, and a sale needs judgement about tax and timing that
 * a split alone cannot supply. Recent performance never enters.
 *
 * Nothing here moves money. Bank money becomes a transfer ticket the owner
 * carries out at the bank; a buy is placed only through the broker-order
 * dialog, after Scalable's full preview and the owner's separate yes.
 */

export type AllocationBucket = "equity" | "bonds" | "cash" | "other";

/** Basis points per class; the owner's split totals 10 000. */
export type TargetSplit = Record<AllocationBucket, number>;

export const BUCKETS: AllocationBucket[] = ["equity", "bonds", "cash", "other"];
const INVESTABLE = ["equity", "bonds", "other"] as const;
type InvestableBucket = (typeof INVESTABLE)[number];

export const BUCKET_LABELS: Record<AllocationBucket, string> = {
	equity: "Aktien",
	bonds: "Anleihen",
	cash: "Cash",
	other: "Sonstige",
};

/** Below this a buy costs more in fees and attention than it moves. */
export const MIN_ORDER_MINOR = 5_000;

/** Bank money above the reserve worth a transfer; ten minimum orders. */
export const MIN_TRANSFER_MINOR = MIN_ORDER_MINOR * 10;

/** A snapshot older than this is too old to size an order on. */
export const STALE_SNAPSHOT_DAYS = 3;

/** Money needed within this many months does not belong in equities. */
const SHORT_HORIZON_MONTHS = 36;

/** The broker names its own instrument types; map what is unambiguous. */
export function providerBucketFor(assetClass: string | null): AllocationBucket {
	switch ((assetClass ?? "").toUpperCase()) {
		case "ETF":
		case "STOCK":
		case "SHARE":
		case "EQUITY":
			return "equity";
		case "BOND":
			return "bonds";
		case "CASH":
			return "cash";
		default:
			return "other";
	}
}

export function splitTotal(split: TargetSplit): number {
	return BUCKETS.reduce((sum, key) => sum + split[key], 0);
}

/** "90 % Aktien / 10 % Cash": the classes the split actually uses. */
export function describeSplit(split: TargetSplit): string {
	return BUCKETS.filter((key) => split[key] > 0)
		.map(
			(key) =>
				`${(split[key] / 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} % ${BUCKET_LABELS[key]}`,
		)
		.join(" / ");
}

/** A holding at the broker: the only instruments a buy can name. */
export type PlanHolding = {
	isin: string;
	name: string;
	bucket: AllocationBucket;
	/** Base currency, converted by the caller. */
	valueMinor: number;
};

export type PlanInput = {
	/** Every liquid balance outside the broker: current, savings, cash, wallets. */
	bankCashMinor: number;
	/** Settled cash at the broker, never buying power or credit. */
	brokerCashMinor: number;
	/** From `requiredReserve`; null when there is no basis for one. */
	reserveMinor: number | null;
	/** Lowest projected liquid balance over the forecast horizon. */
	forecastLowestMinor: number | null;
	forecastLowestDate: string | null;
	holdings: readonly PlanHolding[];
	targets: TargetSplit;
	/** Months until the goal date; null without one. */
	horizonMonths: number | null;
	/** Days since the broker snapshot was taken; null when unknown. */
	snapshotAgeDays: number | null;
	/**
	 * Balance of the one account a transfer comes from; a ticket never asks
	 * for more than it holds. Null when there is no such account.
	 */
	transferLimitMinor: number | null;
};

export type PlanBuy = {
	/** `buy:<isin>`, stable within a plan. */
	key: string;
	isin: string;
	name: string;
	bucket: AllocationBucket;
	amountMinor: number;
};

export type PlanFinding = {
	key: string;
	tone: "info" | "warning";
	text: string;
};

export type InvestmentPlan = {
	/** False while the split does not total 100 %: nothing is proposed then. */
	ready: boolean;
	reserveMinor: number | null;
	/** Held back for a dip the forecast sees below the reserve. */
	upcomingMinor: number;
	/** The split's cash share of the whole portfolio, cash included. */
	cashTargetMinor: number;
	/** Liquid money that stays liquid: max(reserve + dip, cash share). */
	keepMinor: number;
	/** Bank money above what stays liquid. */
	bankFreeMinor: number;
	/** Broker cash above what stays liquid. */
	brokerFreeMinor: number;
	/** The part of `bankFreeMinor` the buys need at the broker. */
	transferMinor: number;
	buys: PlanBuy[];
	findings: PlanFinding[];
	current: TargetSplit;
	after: TargetSplit;
};

function bps(value: number, total: number) {
	return total > 0 ? Math.round((value / total) * 10_000) : 0;
}

function euro(minor: number): string {
	return `${Math.round(minor / 100).toLocaleString("de-DE")} €`;
}

function emptySplit(): TargetSplit {
	return { equity: 0, bonds: 0, cash: 0, other: 0 };
}

/** Splits `total` by weights, handing the rounding remainder to the largest. */
function share<K extends string>(
	total: number,
	weights: Record<K, number>,
): Record<K, number> {
	const keys = Object.keys(weights) as K[];
	const sum = keys.reduce((acc, key) => acc + Math.max(0, weights[key]), 0);
	const result = Object.fromEntries(keys.map((key) => [key, 0])) as Record<
		K,
		number
	>;
	if (sum <= 0 || total <= 0) return result;
	let assigned = 0;
	for (const key of keys) {
		result[key] = Math.floor((total * Math.max(0, weights[key])) / sum);
		assigned += result[key];
	}
	const largest = keys.reduce((best, key) =>
		weights[key] > weights[best] ? key : best,
	);
	result[largest] += total - assigned;
	return result;
}

export function planInvestment(input: PlanInput): InvestmentPlan {
	const findings: PlanFinding[] = [];
	const bankCash = Math.max(0, input.bankCashMinor);
	const brokerCash = Math.max(0, input.brokerCashMinor);
	const reserve = input.reserveMinor ?? 0;

	const values = emptySplit();
	for (const holding of input.holdings)
		values[holding.bucket] += Math.max(0, holding.valueMinor);
	values.cash += bankCash + brokerCash;
	const total = BUCKETS.reduce((sum, key) => sum + values[key], 0);
	const current = Object.fromEntries(
		BUCKETS.map((key) => [key, bps(values[key], total)]),
	) as TargetSplit;

	const upcoming =
		input.forecastLowestMinor !== null && input.forecastLowestMinor < reserve
			? reserve - Math.max(0, input.forecastLowestMinor)
			: 0;
	if (upcoming > 0)
		findings.push({
			key: "upcoming",
			tone: "info",
			text: `Die Prognose sieht den Kontostand${input.forecastLowestDate ? ` am ${input.forecastLowestDate.split("-").reverse().join(".")}` : ""} bei ${euro(input.forecastLowestMinor ?? 0)}, unter der Reserve. ${euro(upcoming)} bleiben deshalb zusätzlich liegen.`,
		});

	const ready = splitTotal(input.targets) === 10_000;
	const cashTarget = ready
		? Math.round((total * input.targets.cash) / 10_000)
		: 0;
	const keep = Math.max(reserve + upcoming, cashTarget);
	// Liquid money stays on the bank first: that is where the reserve lives.
	const bankFree =
		input.reserveMinor === null ? 0 : Math.max(0, bankCash - keep);
	const brokerFree = Math.max(
		0,
		Math.min(brokerCash, bankCash + brokerCash - keep),
	);

	const base = {
		reserveMinor: input.reserveMinor,
		upcomingMinor: upcoming,
		cashTargetMinor: cashTarget,
		keepMinor: keep,
		bankFreeMinor: bankFree,
		brokerFreeMinor: brokerFree,
		current,
	};
	if (!ready)
		return {
			...base,
			ready,
			transferMinor: 0,
			buys: [],
			findings: [
				{
					key: "split",
					tone: "warning",
					text: "Die Zielaufteilung ergibt nicht 100 %. Erst anpassen, dann gibt es einen Vorschlag.",
				},
			],
			after: current,
		};

	if (input.reserveMinor === null)
		findings.push({
			key: "reserve",
			tone: "warning",
			text: "Ohne Reserve bleibt das Geld auf den Konten, wo es ist. Angelegt wird nur das Depotguthaben.",
		});
	if (
		input.snapshotAgeDays === null ||
		input.snapshotAgeDays > STALE_SNAPSHOT_DAYS
	)
		findings.push({
			key: "stale",
			tone: "warning",
			text:
				input.snapshotAgeDays === null
					? "Der Depotstand hat keinen Zeitstempel. Vor einer Order abgleichen."
					: `Der Depotstand ist ${input.snapshotAgeDays} Tage alt. Vor einer Order abgleichen.`,
		});
	if (
		input.horizonMonths !== null &&
		input.horizonMonths < SHORT_HORIZON_MONTHS &&
		input.targets.equity > 0
	)
		findings.push({
			key: "horizon",
			tone: "warning",
			text: `Das Ziel liegt nur ${input.horizonMonths} Monate entfernt, die Aufteilung sieht trotzdem Aktien vor. Geld, das in weniger als drei Jahren gebraucht wird, verträgt keinen Einbruch.`,
		});

	// Buy by the gap of each class to its target, measured on the portfolio
	// as it will be, which is the same total: buying moves cash into a class.
	// One ticket, from one account: never more than that account holds.
	const transferable = Math.min(
		bankFree,
		Math.max(0, input.transferLimitMinor ?? 0),
	);
	if (bankFree - transferable >= MIN_TRANSFER_MINOR)
		findings.push({
			key: "other_accounts",
			tone: "info",
			text: `Weitere ${euro(bankFree - transferable)} über der Reserve liegen auf anderen Konten. Die bleiben, bis Sie sie selbst umbuchen.`,
		});
	const budget = transferable + brokerFree;
	const gaps = Object.fromEntries(
		INVESTABLE.map((key) => [
			key,
			Math.max(
				0,
				Math.round((total * input.targets[key]) / 10_000) - values[key],
			),
		]),
	) as Record<InvestableBucket, number>;
	const gapTotal = INVESTABLE.reduce((sum, key) => sum + gaps[key], 0);
	// Underweight classes first; whatever is left over after closing every
	// gap follows the split itself.
	const byGap = share(Math.min(budget, gapTotal), gaps);
	const byTarget = share(Math.max(0, budget - gapTotal), {
		equity: input.targets.equity,
		bonds: input.targets.bonds,
		other: input.targets.other,
	});
	const slices = Object.fromEntries(
		INVESTABLE.map((key) => [key, byGap[key] + byTarget[key]]),
	) as Record<InvestableBucket, number>;

	const buys: PlanBuy[] = [];
	const after = { ...values };
	for (const key of INVESTABLE) {
		// Whole euros: an order for 4.312,57 € reads like a calculation error.
		const amount = Math.floor(slices[key] / 100) * 100;
		if (amount <= 0) continue;
		const holding = input.holdings
			.filter((row) => row.bucket === key && row.valueMinor > 0)
			.sort((left, right) => right.valueMinor - left.valueMinor)[0];
		if (!holding) {
			findings.push({
				key: `no_holding:${key}`,
				tone: "info",
				text: `Für ${BUCKET_LABELS[key]} liegt noch kein Wertpapier im Depot. ${euro(amount)} bleiben liegen, bis Sie selbst eins gewählt haben.`,
			});
			continue;
		}
		if (amount < MIN_ORDER_MINOR) {
			findings.push({
				key: `too_small:${key}`,
				tone: "info",
				text: `${euro(amount)} für ${BUCKET_LABELS[key]} sind für eine eigene Order zu wenig. Beim nächsten Mal zusammen anlegen.`,
			});
			continue;
		}
		buys.push({
			key: `buy:${holding.isin}`,
			isin: holding.isin,
			name: holding.name,
			bucket: key,
			amountMinor: amount,
		});
		after[key] += amount;
		after.cash -= amount;
	}
	const bought = buys.reduce((sum, buy) => sum + buy.amountMinor, 0);
	const transfer = Math.min(transferable, Math.max(0, bought - brokerFree));

	return {
		...base,
		ready,
		transferMinor: transfer,
		buys,
		findings,
		after: Object.fromEntries(
			BUCKETS.map((key) => [key, bps(after[key], total)]),
		) as TargetSplit,
	};
}
