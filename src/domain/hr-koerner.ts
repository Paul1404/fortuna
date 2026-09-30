import { addDays, addMonths, daysBetween } from "./dates";
import { formatMoney } from "./money";

// Recurring amounts are stored signed: an outflow is negative. Every threshold
// below compares magnitudes so a real outflow is not silently skipped.
/** A payment big enough to be worth warning about before it lands. */
const DEFAULT_LARGE_PAYMENT_MINOR = 50_000;
/** A single purchase worth comparing against its own baseline. */
const DEFAULT_NOTABLE_SPEND_MINOR = 5_000;
/** Per-month cost below which a subscription counts as a small leak. */
const SMALL_SUBSCRIPTION_MINOR = 1_500;

export type ObservationCandidate = {
	key: string;
	type: string;
	severity: "info" | "notable" | "review" | "urgent";
	title: string;
	explanation: string;
	evidence: Record<string, unknown>;
	sourceEntities: string[];
	currency: string | null;
	impactMinor: number | null;
	confidence: "high" | "medium" | "low";
	periodStart: string | null;
	periodEnd: string | null;
	actionable: boolean;
};

export type ReviewInput = {
	today: string;
	baseCurrency: string;
	cashMinor: number;
	/**
	 * From `requiredReserve` (`reserve.ts`), already in base currency: the one
	 * reserve rule the desk and "Anlegen" use too. Null without any basis.
	 */
	reserveMinor: number | null;
	profile: {
		currency?: string;
		largePurchaseThresholdMinor: number | null;
		unusualSpendMultiplierBps: number;
		ignoredCategoryIds: string[];
		alertSensitivity?: "quiet" | "balanced" | "detailed";
	};
	transactions: {
		id: string;
		bookingDate: string;
		amountMinor: number;
		currency: string;
		merchantName: string | null;
		categoryId: string | null;
		transferGroupId: string | null;
		status: string;
	}[];
	recurring: {
		id: string;
		name: string;
		direction: string;
		currency: string;
		isSubscription: boolean;
		monthlyEquivalentMinor: number;
		expectedAmountMinor?: number;
		nextExpected?: string | null;
		/** What it cost before, when detection saw the amount move and stay. */
		previousAmountMinor?: number | null;
		priceChangedAt?: string | null;
	}[];
	staleValuations: {
		id: string;
		name: string;
		kind: string;
		ageDays: number | null;
	}[];
	/**
	 * Fixed costs and income per full calendar month, oldest first, in base
	 * currency — only months fully covered by the owner's data. Missing means
	 * the lifestyle-creep rule is not evaluated.
	 */
	fixedCostTrend?: FixedCostTrendMonth[];
};

export type FixedCostTrendMonth = {
	/** `YYYY-MM`. */
	month: string;
	/** Positive: Fixkosten as the page counts them, in that month. */
	fixedCostsMinor: number;
	/** Positive: the month's income from the cashflow report. */
	incomeMinor: number;
};

/**
 * Below this many full months a trend in fixed costs is noise: a new
 * subscription and a missing bonus look like creep. The rule stays silent.
 */
export const CREEP_MIN_FULL_MONTHS = 6;
/** Fixed costs must grow by at least this much (5 %)… */
const CREEP_MIN_GROWTH_BPS = 500;
/** …and at least this many percentage points faster than income (5 pp)… */
const CREEP_MIN_GAP_BPS = 500;
/** …and by at least this much a month, or it is not worth a sentence. */
const CREEP_MIN_MONTHLY_INCREASE_MINOR = 2_500;

function quarterOf(month: string): { key: string; start: string } {
	const year = Number(month.slice(0, 4));
	const q = Math.floor((Number(month.slice(5, 7)) - 1) / 3);
	return {
		key: `${year}-Q${q + 1}`,
		start: `${year}-${String(q * 3 + 1).padStart(2, "0")}`,
	};
}

function shiftMonth(month: string, by: number): string {
	return addMonths(`${month}-01`, by).slice(0, 7);
}

function monthsFrom(start: string, count: number): string[] {
	return Array.from({ length: count }, (_, index) => shiftMonth(start, index));
}

function percentText(bps: number): string {
	const text = new Intl.NumberFormat("de-DE", {
		maximumFractionDigits: 0,
	}).format(Math.abs(bps) / 100);
	return `${bps < 0 ? "−" : bps > 0 ? "+" : ""}${text} %`;
}

/**
 * Lifestyle creep: the fixed costs growing faster than the income.
 *
 * Compared by calendar quarter — the latest full quarter against the same
 * quarter a year earlier once the data reaches back that far, else against
 * the quarter before — so each quarter is judged once, keyed on it, and a
 * dismissal is not undone by next month's rolling window. Averages over
 * three months absorb a yearly premium or a single bonus. An observation,
 * not a verdict: a new insurance can be exactly the right decision.
 */
export function detectLifestyleCreep(
	months: readonly FixedCostTrendMonth[],
	currency: string,
): ObservationCandidate | null {
	if (months.length < CREEP_MIN_FULL_MONTHS) return null;
	const byMonth = new Map(months.map((row) => [row.month, row]));
	const covered = (keys: string[]) => keys.every((key) => byMonth.has(key));
	// The latest quarter whose three months are all in the data.
	let quarter = quarterOf(months[months.length - 1].month);
	if (!covered(monthsFrom(quarter.start, 3)))
		quarter = quarterOf(shiftMonth(quarter.start, -3));
	const recent = monthsFrom(quarter.start, 3);
	if (!covered(recent)) return null;
	const yearAgo = monthsFrom(shiftMonth(quarter.start, -12), 3);
	const before = monthsFrom(shiftMonth(quarter.start, -3), 3);
	const compare = covered(yearAgo)
		? { months: yearAgo, kind: "year" as const }
		: covered(before)
			? { months: before, kind: "quarter" as const }
			: null;
	if (!compare) return null;

	const average = (
		keys: string[],
		pick: (row: FixedCostTrendMonth) => number,
	) =>
		Math.round(
			keys.reduce(
				(sum, key) => sum + pick(byMonth.get(key) as FixedCostTrendMonth),
				0,
			) / keys.length,
		);
	const fixedBefore = average(compare.months, (row) => row.fixedCostsMinor);
	const fixedNow = average(recent, (row) => row.fixedCostsMinor);
	const incomeBefore = average(compare.months, (row) => row.incomeMinor);
	const incomeNow = average(recent, (row) => row.incomeMinor);
	if (fixedBefore <= 0 || incomeBefore <= 0) return null;
	const fixedGrowthBps = Math.round(
		((fixedNow - fixedBefore) * 10_000) / fixedBefore,
	);
	const incomeGrowthBps = Math.round(
		((incomeNow - incomeBefore) * 10_000) / incomeBefore,
	);
	if (
		fixedGrowthBps < CREEP_MIN_GROWTH_BPS ||
		fixedGrowthBps - incomeGrowthBps < CREEP_MIN_GAP_BPS ||
		fixedNow - fixedBefore < CREEP_MIN_MONTHLY_INCREASE_MINOR
	)
		return null;

	const [year, q] = quarter.key.split("-");
	const compared =
		compare.kind === "year" ? "ein Jahr zuvor" : "im Quartal davor";
	return {
		key: `lifestyle_creep:${quarter.key}`,
		type: "lifestyle_creep",
		severity: "info",
		title: "Fixkosten wachsen schneller als das Einkommen",
		explanation: `Im ${q.slice(1)}. Quartal ${year} lagen die Fixkosten bei ${formatMoney(fixedNow, currency)} im Monat, ${percentText(fixedGrowthBps)} gegenüber ${compared}. Das Einkommen: ${percentText(incomeGrowthBps)}. Eine Beobachtung, kein Urteil.`,
		evidence: {
			fixedCostsBeforeMinor: fixedBefore,
			fixedCostsNowMinor: fixedNow,
			incomeBeforeMinor: incomeBefore,
			incomeNowMinor: incomeNow,
			fixedGrowthBps,
			incomeGrowthBps,
			comparedWith: compare.kind,
		},
		sourceEntities: [],
		currency,
		impactMinor: fixedNow - fixedBefore,
		confidence: "medium",
		periodStart: `${compare.months[0]}-01`,
		periodEnd: addDays(`${shiftMonth(recent[2], 1)}-01`, -1),
		actionable: false,
	};
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const center = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? sorted[center]
		: Math.round((sorted[center - 1] + sorted[center]) / 2);
}

/** An estimate, not a prediction: days required to replenish a cost from a stated monthly saving rate. */
export function estimateGoalDelayDays(
	purchaseMinor: number,
	monthlySavingsMinor: number | null,
): number | null {
	if (purchaseMinor <= 0 || !monthlySavingsMinor || monthlySavingsMinor <= 0)
		return null;
	return Math.ceil((purchaseMinor * 30.4375) / monthlySavingsMinor);
}

/** Linear savings-only horizon, with no investment return assumptions. */
export function estimateMonthsToGoal(
	targetMinor: number,
	currentMinor: number,
	monthlySavingsMinor: number | null,
): number | null {
	if (targetMinor <= currentMinor) return 0;
	if (!monthlySavingsMinor || monthlySavingsMinor <= 0) return null;
	return Math.ceil((targetMinor - currentMinor) / monthlySavingsMinor);
}

export function detectFinancialObservations(
	input: ReviewInput,
): ObservationCandidate[] {
	const findings: ObservationCandidate[] = [];
	// Monetary profile values carry the currency they were entered in. After a
	// base-currency change none of them may be compared with base amounts
	// until the owner enters them again.
	const profileComparable =
		(input.profile.currency ?? input.baseCurrency) === input.baseCurrency;
	const purchaseThreshold = profileComparable
		? input.profile.largePurchaseThresholdMinor
		: null;
	const reserve = input.reserveMinor;
	if (reserve !== null && reserve > 0 && input.cashMinor < reserve) {
		const shortfall = reserve - input.cashMinor;
		findings.push({
			key: "liquidity:reserve",
			type: "liquidity_below_floor",
			severity: "urgent",
			title: "Liquiditätsreserve unterschritten",
			explanation:
				"Der aktuelle liquide Bestand liegt unter der Reserve aus Ihren Zielen (Monatsausgaben oder Mindestreserve, der größere Betrag).",
			evidence: {
				cashMinor: input.cashMinor,
				reserveMinor: reserve,
				shortfallMinor: shortfall,
			},
			sourceEntities: [],
			currency: input.baseCurrency,
			impactMinor: shortfall,
			confidence: "high",
			periodStart: input.today,
			periodEnd: input.today,
			actionable: true,
		});
	}
	if (reserve !== null && reserve > 0) {
		for (const row of input.recurring) {
			if (
				row.direction !== "outflow" ||
				row.currency !== input.baseCurrency ||
				!row.nextExpected ||
				!row.expectedAmountMinor ||
				row.nextExpected < input.today ||
				daysBetween(input.today, row.nextExpected) > 7 ||
				Math.abs(row.expectedAmountMinor) <
					(purchaseThreshold ?? DEFAULT_LARGE_PAYMENT_MINOR) ||
				input.cashMinor - Math.abs(row.expectedAmountMinor) >= reserve
			)
				continue;
			findings.push({
				key: `upcoming_payment:${row.id}:${row.nextExpected}`,
				type: "upcoming_large_payment",
				severity: "review",
				title: `Anstehende Zahlung: ${row.name}`,
				explanation:
					"Diese erwartete Zahlung könnte die Reserve unterschreiten. Der Termin und Betrag stammen aus der wiederkehrenden Zahlung, nicht aus einer bestätigten neuen Buchung.",
				evidence: {
					expectedAmountMinor: row.expectedAmountMinor,
					expectedDate: row.nextExpected,
					cashAfterMinor: input.cashMinor - Math.abs(row.expectedAmountMinor),
					reserveMinor: reserve,
				},
				sourceEntities: [row.id],
				currency: input.baseCurrency,
				impactMinor: Math.max(
					0,
					reserve - (input.cashMinor - Math.abs(row.expectedAmountMinor)),
				),
				confidence: "medium",
				periodStart: input.today,
				periodEnd: row.nextExpected,
				actionable: true,
			});
		}
	}

	const since = addDays(input.today, -90);
	const eligible = input.transactions.filter(
		(tx) =>
			tx.bookingDate >= since &&
			tx.bookingDate <= input.today &&
			tx.amountMinor < 0 &&
			tx.currency === input.baseCurrency &&
			tx.status === "booked" &&
			!tx.transferGroupId &&
			!input.profile.ignoredCategoryIds.includes(tx.categoryId ?? ""),
	);
	const byMerchant = new Map<string, typeof eligible>();
	for (const tx of eligible) {
		const key = tx.merchantName?.trim().toLocaleLowerCase("de-DE");
		if (!key) continue;
		byMerchant.set(key, [...(byMerchant.get(key) ?? []), tx]);
	}
	for (const merchantTransactions of byMerchant.values()) {
		const ordered = [...merchantTransactions].sort(
			(a, b) =>
				a.bookingDate.localeCompare(b.bookingDate) || a.id.localeCompare(b.id),
		);
		for (let index = 3; index < ordered.length; index++) {
			const current = ordered[index];
			if (daysBetween(current.bookingDate, input.today) > 14) continue;
			const prior = ordered.slice(0, index);
			const baseline = median(prior.map((tx) => -tx.amountMinor));
			const spent = -current.amountMinor;
			if (
				baseline < 1 ||
				spent < (purchaseThreshold ?? DEFAULT_NOTABLE_SPEND_MINOR) ||
				spent * 10000 < baseline * input.profile.unusualSpendMultiplierBps
			)
				continue;
			findings.push({
				key: `unusual_spend:${current.id}`,
				type: "unusual_spend",
				severity: "notable",
				title: `Ungewöhnliche Ausgabe bei ${current.merchantName}`,
				explanation:
					"Diese Buchung liegt deutlich über Ihrem bisherigen Median bei diesem Händler. Das ist auffällig, nicht automatisch falsch.",
				evidence: {
					transactionId: current.id,
					spentMinor: spent,
					merchantMedianMinor: baseline,
					priorCount: prior.length,
					ratioBps: Math.round((spent * 10000) / baseline),
				},
				sourceEntities: [current.id, ...prior.slice(-20).map((tx) => tx.id)],
				currency: input.baseCurrency,
				impactMinor: null,
				confidence: "medium",
				periodStart: since,
				periodEnd: input.today,
				actionable: true,
			});
		}
	}

	// A payment that got more expensive is not a task to tick off: the owner
	// decides whether it bothers them. That is exactly what an observation is —
	// it can be dismissed, snoozed, or marked as intended — and it is why
	// detection quietly rewriting the amount was the wrong answer.
	for (const row of input.recurring) {
		const previous = row.previousAmountMinor;
		if (!previous || !row.priceChangedAt) continue;
		// Detection records a new level for income too; a raise is not a
		// payment that got more expensive.
		if (row.direction !== "outflow") continue;
		if (row.currency !== input.baseCurrency) continue;
		const from = Math.abs(previous);
		const to = Math.abs(row.expectedAmountMinor ?? 0);
		if (from === 0 || to <= from) continue;
		// The rise per year at this payment's own cadence: the monthly figure is
		// already cadence-adjusted, so scaling it by the relative increase gives
		// the yearly difference for monthly and yearly payments alike.
		const monthlyNow = Math.abs(row.monthlyEquivalentMinor);
		const annualDifference = Math.round((monthlyNow * (to - from) * 12) / to);
		const symbol = row.currency === "EUR" ? "€" : row.currency;
		findings.push({
			// Keyed on the date so a later rise is a new finding, while the same
			// one is never reported twice.
			key: `price_increase:${row.id}:${row.priceChangedAt}`,
			type: "recurring_price_increase",
			severity: annualDifference >= 5_000 ? "review" : "notable",
			title: `${row.name} ist teurer geworden`,
			explanation: `Seit ${row.priceChangedAt} werden ${(to / 100).toFixed(2).replace(".", ",")} ${symbol} statt ${(from / 100).toFixed(2).replace(".", ",")} ${symbol} abgebucht.`,
			evidence: {
				fromMinor: from,
				toMinor: to,
				since: row.priceChangedAt,
				annualDifferenceMinor: annualDifference,
			},
			sourceEntities: [row.id],
			currency: input.baseCurrency,
			impactMinor: annualDifference,
			confidence: "high",
			periodStart: row.priceChangedAt,
			periodEnd: input.today,
			actionable: true,
		});
	}

	const smallSubscriptions = input.recurring.filter(
		(row) =>
			row.isSubscription &&
			row.direction === "outflow" &&
			row.currency === input.baseCurrency &&
			Math.abs(row.monthlyEquivalentMinor) > 0 &&
			Math.abs(row.monthlyEquivalentMinor) <= SMALL_SUBSCRIPTION_MINOR,
	);
	const monthly = smallSubscriptions.reduce(
		(sum, row) => sum + Math.abs(row.monthlyEquivalentMinor),
		0,
	);
	if (smallSubscriptions.length >= 3 && monthly >= 3000) {
		findings.push({
			key: `recurring_leak:${smallSubscriptions
				.map((row) => row.id)
				.sort()
				.join(":")}`,
			type: "repeated_small_leak",
			severity: "review",
			title: "Kleine Abos, relevante Jahressumme",
			explanation:
				"Mehrere kleine Abos summieren sich. Ob Sie sie nutzen, ist aus Zahlungen allein nicht erkennbar.",
			evidence: {
				count: smallSubscriptions.length,
				monthlyMinor: monthly,
				annualMinor: monthly * 12,
			},
			sourceEntities: smallSubscriptions.map((row) => row.id),
			currency: input.baseCurrency,
			impactMinor: monthly * 12,
			confidence: "high",
			periodStart: null,
			periodEnd: input.today,
			actionable: true,
		});
	}

	if (input.fixedCostTrend) {
		const creep = detectLifestyleCreep(
			input.fixedCostTrend,
			input.baseCurrency,
		);
		if (creep) findings.push(creep);
	}

	for (const row of input.staleValuations) {
		if (
			row.ageDays !== null &&
			row.ageDays <= (input.profile.alertSensitivity === "detailed" ? 14 : 30)
		)
			continue;
		findings.push({
			key: `stale_valuation:${row.kind}:${row.id}`,
			type: "stale_asset_valuation",
			severity: "notable",
			title: `Wert prüfen: ${row.name}`,
			explanation:
				row.ageDays === null
					? "Für diesen Vermögenswert fehlt ein Bewertungsdatum."
					: `Die letzte Bewertung ist ${row.ageDays} Tage alt. Der ausgewiesene Wert kann überholt sein.`,
			evidence: { kind: row.kind, ageDays: row.ageDays },
			sourceEntities: [row.id],
			currency: null,
			impactMinor: null,
			confidence: "high",
			periodStart: null,
			periodEnd: input.today,
			actionable: true,
		});
	}
	return findings;
}
