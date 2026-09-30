import { addDays, daysBetween, endOfMonth, todayIso } from "./dates";

/**
 * The date the "Datum eintragen" field starts on, so the common case is one
 * tap. Without a contract the old cost usually stops the day the switch was
 * made. A linked contract ends the day before it would renew; without a
 * renewal date, at the end of the current month. Only a starting value: the
 * owner confirms it, and nothing is saved until they do.
 */
export function suggestedSavingDate(
	missing: "contract_end" | "saving_from",
	input: { completedAt: string | null; renewalDate?: string | null },
	today: string = todayIso(),
): string {
	if (missing === "saving_from") return input.completedAt ?? today;
	return input.renewalDate ? addDays(input.renewalDate, -1) : endOfMonth(today);
}

export type OptimizationStatus = "idea" | "planned" | "completed" | "dismissed";
export type OptimizationCategory =
	| "banking"
	| "subscription"
	| "insurance"
	| "utilities"
	| "shopping"
	| "mobility"
	| "other";

/**
 * Costs you cannot make cheaper by switching provider. Rent, a mortgage, a car
 * loan and a savings plan were all offered as "Kosten-Checks" beside a
 * streaming subscription, and the dialog then previewed the rent itself as the
 * saving. The category is the reliable signal; the name is a fallback for a
 * payment the owner has not categorised yet.
 */
const NOT_SWITCHABLE_SLUGS = new Set([
	"rent-mortgage",
	"loan-repayment",
	"taxes-fees",
	"savings-transfer",
	"investments",
]);

const NOT_SWITCHABLE_NAME =
	/miete|hausverwaltung|pacht|kredit|darlehen|tilgung|bauspar|hypothek|finanzierung|steuer|sparplan|sparrate|unterhalt/u;

export function switchableCost(
	title: string,
	categorySlug: string | null,
): boolean {
	if (categorySlug && NOT_SWITCHABLE_SLUGS.has(categorySlug)) return false;
	return !NOT_SWITCHABLE_NAME.test(title.toLocaleLowerCase("de"));
}

export function optimizationCategoryForTitle(
	title: string,
): OptimizationCategory {
	const value = title.toLocaleLowerCase("de");
	if (/amex|american express|mastercard|visa|bank|konto|karte/u.test(value))
		return "banking";
	if (/versicherung|allianz|huk|devk/u.test(value)) return "insurance";
	if (/strom|gas|energie|internet|mobilfunk|telekom|vodafone/u.test(value))
		return "utilities";
	if (/auto|bahn|ticket|tanken|mobilität/u.test(value)) return "mobility";
	return "subscription";
}

export type OptimizationCosts = {
	currentMonthlyMinor: number;
	alternativeMonthlyMinor: number;
	oneTimeCostMinor: number;
};

export function optimizationSavings(costs: OptimizationCosts) {
	const monthlyMinor =
		costs.currentMonthlyMinor - costs.alternativeMonthlyMinor;
	const atMonths = (months: number) =>
		monthlyMinor * months - costs.oneTimeCostMinor;
	return {
		monthlyMinor,
		annualMinor: monthlyMinor * 12,
		firstYearMinor: atMonths(12),
		threeYearsMinor: atMonths(36),
		fiveYearsMinor: atMonths(60),
		paybackMonths:
			monthlyMinor > 0 && costs.oneTimeCostMinor > 0
				? costs.oneTimeCostMinor / monthlyMinor
				: costs.oneTimeCostMinor === 0 && monthlyMinor > 0
					? 0
					: null,
	};
}

/**
 * What a Sparmission is doing right now.
 *
 * A mission used to be either "not started" or "saving since the day you
 * ticked it", which is two states for something with four. Between giving
 * notice and the old contract actually ending you pay the old price; after
 * that you are still down the switching fee until it pays for itself. Both of
 * those are progress, and showing 0,00 € through either of them made a mission
 * that was going fine look like one that had stalled.
 */
export type SavingsPhase =
	/** Not switched yet. Everything is still potential. */
	| "planned"
	/**
	 * Switched, but nobody has said when the old cost stops: no linked contract
	 * with an end date and no date of its own. Ticking a mission off used to
	 * start the saving that day, so a subscription cancelled at the end of a
	 * paid year read as money saved for the whole year it was still charged.
	 */
	| "undated"
	/** Switched, but the old contract still runs and still costs the old price. */
	| "waiting"
	/** Saving, but the switching cost is not yet earned back. */
	| "earning_back"
	/** Saving, switching cost recovered. */
	| "saving"
	/**
	 * Switched to something that costs the same or more. There is no switching
	 * fee to earn back because nothing ever pays it back: left in
	 * `earning_back`, the outstanding amount only grew and "Rechnet sich bald"
	 * promised a day that never comes.
	 */
	| "no_saving";

export type SavingsProgress = {
	phase: SavingsPhase;
	/** The day the old cost actually stops and the saving starts. */
	savingFrom: string | null;
	/** Why there is no start date yet, while `undated`. */
	missing: "contract_end" | "saving_from" | null;
	/** Saved so far after switching costs; never negative, see `phase`. */
	realizedMinor: number;
	/** Still to earn back before the switch has paid for itself. */
	outstandingCostMinor: number;
	/** The day the switching cost is earned back, once that day is knowable. */
	paybackOn: string | null;
	/** Days until the old contract stops, while waiting. */
	daysUntilSaving: number | null;
};

/**
 * When the old money actually stops leaving the account.
 *
 * A linked contract owns that date: the saving starts the day after it ends,
 * and not before a later date the owner gave. A linked contract without an end
 * is still running, so there is no start yet. Without a contract only the
 * owner's own `savingFrom` counts — never the day the mission was ticked off.
 */
export function savingStartDate(input: {
	savingFrom: string | null;
	oldContract?: { endsOn: string | null } | null;
}): { date: string | null; missing: SavingsProgress["missing"] } {
	if (input.oldContract) {
		if (!input.oldContract.endsOn)
			return { date: null, missing: "contract_end" };
		const afterEnd = addDays(input.oldContract.endsOn, 1);
		return {
			date:
				input.savingFrom && input.savingFrom > afterEnd
					? input.savingFrom
					: afterEnd,
			missing: null,
		};
	}
	return input.savingFrom
		? { date: input.savingFrom, missing: null }
		: { date: null, missing: "saving_from" };
}

export function savingsProgress(
	costs: OptimizationCosts,
	input: {
		status: OptimizationStatus;
		savingFrom: string | null;
		oldContract?: { endsOn: string | null } | null;
	},
	asOf = todayIso(),
): SavingsProgress {
	const monthlyMinor = optimizationSavings(costs).monthlyMinor;
	const empty = {
		missing: null,
		realizedMinor: 0,
		outstandingCostMinor: costs.oneTimeCostMinor,
		paybackOn: null,
		daysUntilSaving: null,
	};
	if (input.status !== "completed")
		return { phase: "planned", savingFrom: null, ...empty };

	const start = savingStartDate(input);
	// Nothing saved, nothing outstanding that could ever be earned back, and no
	// payback day. The monthly difference itself tells the owner what it costs.
	if (monthlyMinor <= 0)
		return {
			phase: "no_saving",
			savingFrom: start.date,
			missing: start.missing,
			realizedMinor: 0,
			outstandingCostMinor: 0,
			paybackOn: null,
			daysUntilSaving: null,
		};
	if (!start.date)
		return {
			phase: "undated",
			savingFrom: null,
			...empty,
			missing: start.missing,
		};
	const savingFrom = start.date;

	const paybackOn =
		costs.oneTimeCostMinor > 0
			? addDays(
					savingFrom,
					Math.ceil((costs.oneTimeCostMinor / monthlyMinor) * (365.2425 / 12)),
				)
			: savingFrom;

	if (savingFrom > asOf)
		return {
			phase: "waiting",
			savingFrom,
			...empty,
			paybackOn,
			daysUntilSaving: daysBetween(asOf, savingFrom),
		};

	const elapsedMonths = daysBetween(savingFrom, asOf) / (365.2425 / 12);
	const gross = Math.round(monthlyMinor * elapsedMonths);
	const net = gross - costs.oneTimeCostMinor;
	if (net < 0)
		return {
			phase: "earning_back",
			savingFrom,
			missing: null,
			realizedMinor: 0,
			outstandingCostMinor: -net,
			paybackOn,
			daysUntilSaving: null,
		};
	return {
		phase: "saving",
		savingFrom,
		missing: null,
		realizedMinor: net,
		outstandingCostMinor: 0,
		paybackOn,
		daysUntilSaving: null,
	};
}

export function realizedSavingsMinor(
	costs: OptimizationCosts,
	savingFrom: string | null,
	asOf = todayIso(),
): number {
	return savingsProgress(costs, { status: "completed", savingFrom }, asOf)
		.realizedMinor;
}

const milestones = [
	10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000,
];

export function savingsMilestone(realizedMinor: number) {
	const safe = Math.max(0, realizedMinor);
	const next =
		milestones.find((value) => value > safe) ??
		Math.ceil((safe + 1) / 1_000_000) * 1_000_000;
	const previous =
		[...milestones].reverse().find((value) => value <= safe) ?? 0;
	return {
		previousMinor: previous,
		nextMinor: next,
		progress: next === previous ? 1 : (safe - previous) / (next - previous),
	};
}

export function monthlyEquivalentMinor(
	amountMinor: number,
	frequency:
		| "weekly"
		| "biweekly"
		| "monthly"
		| "bimonthly"
		| "quarterly"
		| "semiannual"
		| "yearly"
		| "custom",
	intervalDays?: number | null,
): number {
	const amount = Math.abs(amountMinor);
	switch (frequency) {
		case "weekly":
			return Math.round((amount * 52) / 12);
		case "biweekly":
			return Math.round((amount * 26) / 12);
		case "bimonthly":
			return Math.round(amount / 2);
		case "quarterly":
			return Math.round(amount / 3);
		case "semiannual":
			return Math.round(amount / 6);
		case "yearly":
			return Math.round(amount / 12);
		case "custom":
			return intervalDays && intervalDays > 0
				? Math.round((amount * (365.2425 / intervalDays)) / 12)
				: amount;
		default:
			return amount;
	}
}
