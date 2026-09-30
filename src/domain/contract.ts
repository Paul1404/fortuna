import { addDays, daysBetween, type IsoDate, todayIso } from "./dates";
import {
	defaultIntervalDays,
	type Frequency,
	monthlyEquivalentMinor,
	occurrencesBetween,
} from "./recurring";

/**
 * A contract is the one object in Fortuna that has a real lifecycle, and both
 * the recurring payment and the Sparmission that reference it borrow their
 * dates from it.
 *
 * The stored `status` is what the owner last recorded; it is not the whole
 * truth, because a contract cancelled in September with an end date of 31.10.
 * is still costing money in October. Everything that needs to know "does this
 * cost me anything today" must ask for the phase, never read `status`.
 */

export type ContractStatus = "active" | "cancelled" | "ended";

export type ContractPhase =
	/** Running with no end in sight. */
	| "running"
	/** Notice given, still running and still costing money until `costsUntil`. */
	| "cancelled_running"
	/** Over. Costs nothing. */
	| "ended";

export type ContractLifecycleInput = {
	status: ContractStatus;
	startDate: IsoDate | null;
	endDate: IsoDate | null;
	cancellationDate: IsoDate | null;
	renewalDate: IsoDate | null;
	noticePeriodDays: number | null;
};

/**
 * The last day the contract costs money, or null when it has no known end.
 *
 * `endDate` is the date the contract stops. `cancellationDate` is the day
 * notice was given, which is not the same thing and must never be used as the
 * end: giving notice today does not stop this month's debit.
 */
export function contractCostsUntil(
	contract: ContractLifecycleInput,
): IsoDate | null {
	return contract.endDate ?? null;
}

export function contractPhase(
	contract: ContractLifecycleInput,
	asOf: IsoDate = todayIso(),
): ContractPhase {
	const until = contractCostsUntil(contract);
	if (contract.status === "ended") return "ended";
	// An end date in the past ends the contract whatever the stored status
	// says: nobody goes back to flip the switch on the day it runs out.
	if (until && until < asOf) return "ended";
	if (contract.status === "cancelled") return "cancelled_running";
	return "running";
}

/** True while the contract still has to be paid. */
export function contractIsCosting(
	contract: ContractLifecycleInput,
	asOf: IsoDate = todayIso(),
): boolean {
	if (contractPhase(contract, asOf) === "ended") return false;
	// A contract that has not started yet costs nothing either.
	return !contract.startDate || contract.startDate <= asOf;
}

/**
 * The monthly cost as long as the contract runs, and 0 once it has ended.
 *
 * `custom` has no interval on a contract, so it cannot be converted at all;
 * the caller has to report it as uncounted rather than guess a month.
 */
export function contractMonthlyCostMinor(
	contract: ContractLifecycleInput & {
		costMinor: number | null;
		frequency: string | null;
	},
	asOf: IsoDate = todayIso(),
): number | null {
	if (!contractIsCosting(contract, asOf)) return 0;
	if (contract.costMinor === null || contract.frequency === null) return null;
	if (contract.frequency === "custom") return null;
	return monthlyEquivalentMinor(
		contract.costMinor,
		contract.frequency as Parameters<typeof monthlyEquivalentMinor>[1],
		30,
	);
}

export type NoticeDeadline = {
	/** The last day notice can be given to stop the next term. */
	date: IsoDate;
	/** Days from `asOf` to that day; negative once it has passed. */
	daysLeft: number;
	/** What the contract runs into if notice is not given. */
	renewsOn: IsoDate;
};

/**
 * When notice has to be given to stop the contract at its next term.
 *
 * Only a contract that is still running has a deadline — once notice is given
 * there is nothing left to miss. A contract with no notice period or no term
 * date has no deadline Fortuna can compute, and says so rather than inventing
 * one.
 */
export function noticeDeadline(
	contract: ContractLifecycleInput,
	asOf: IsoDate = todayIso(),
): NoticeDeadline | null {
	if (contractPhase(contract, asOf) !== "running") return null;
	if (!contract.noticePeriodDays || contract.noticePeriodDays <= 0) return null;
	const renewsOn = contract.renewalDate ?? contract.endDate;
	if (!renewsOn || renewsOn < asOf) return null;
	const date = addDays(renewsOn, -contract.noticePeriodDays);
	return { date, daysLeft: daysBetween(asOf, date), renewsOn };
}

/**
 * A contract as a future outflow the forecast can count.
 *
 * Detection can never find a yearly payment: one or two bookings give no
 * cadence to infer, so a car insurance debited every March was invisible in
 * the forecast until the owner typed it in as a recurring payment by hand.
 * But it is already fully described as a contract — cost, cadence, start — so
 * the forecast can read it from there instead of guessing it from bookings.
 *
 * The anchor is the start date: a contract beginning 15 March is due on the
 * 15th of March, and `occurrencesBetween` counts months from that anchor
 * rather than stepping from the previously clamped date.
 */
export type ContractSchedule = ContractLifecycleInput & {
	id: string;
	name: string;
	costMinor: number | null;
	currency: string;
	frequency: string | null;
	/** Set when a recurring payment already carries this contract's bookings. */
	recurringPaymentId?: string | null;
	/** `payroll`: the employer pays it out of gross salary. */
	paidVia?: string | null;
};

export type ContractForecastEntry = {
	contractId: string;
	name: string;
	/** Signed: a contract costs money, so this is negative. */
	amountMinor: number;
	currency: string;
	frequency: string;
	nextDue: IsoDate;
	/** Days between due dates for a cadence not counted in months. */
	intervalDays: number;
	/**
	 * Day of the month the contract is due on, from its start date. `nextDue`
	 * may be clamped (30.09. for a contract started on the 31st); later months
	 * must still be counted from the start date's day.
	 */
	typicalDay: number;
	/** Last day it is still due, from the contract's own end. */
	endsAfter: IsoDate | null;
};

/** Why a contract cannot be projected, so it can be reported instead of dropped. */
export type ContractScheduleGap =
	| "no_cost"
	| "no_cadence"
	| "custom_cadence"
	| "no_start";

export function contractForecastEntry(
	contract: ContractSchedule,
	asOf: IsoDate = todayIso(),
): { entry: ContractForecastEntry } | { gap: ContractScheduleGap } | null {
	// Ended, or paid through a recurring payment that the forecast already
	// counts: adding it here would charge the same money twice. A contract
	// that has not started yet is not costing anything today, but the forecast
	// looks ahead: it is due from its start date, which the anchor below gives.
	if (contractPhase(contract, asOf) === "ended") return null;
	if (contract.recurringPaymentId) return null;
	// Salary conversion: the employer pays it before the salary arrives, so
	// it never leaves the account and has no place in the account's forecast.
	if (contract.paidVia === "payroll") return null;
	if (contract.costMinor === null || contract.costMinor === 0)
		return { gap: "no_cost" };
	if (!contract.frequency) return { gap: "no_cadence" };
	if (contract.frequency === "custom") return { gap: "custom_cadence" };
	if (!contract.startDate) return { gap: "no_start" };

	const until = contractCostsUntil(contract);
	const horizon =
		until && until < addDays(asOf, 800) ? until : addDays(asOf, 800);
	const frequency = contract.frequency as Frequency;
	// A weekly contract stepped by 30 days was projected once a month.
	const intervalDays = defaultIntervalDays(frequency);
	const next = occurrencesBetween(
		contract.startDate,
		frequency,
		intervalDays,
		asOf,
		horizon,
	)[0];
	if (!next) return null;
	return {
		entry: {
			contractId: contract.id,
			name: contract.name,
			amountMinor: -Math.abs(contract.costMinor),
			currency: contract.currency,
			frequency: contract.frequency,
			nextDue: next,
			intervalDays,
			typicalDay: Number(contract.startDate.slice(8, 10)),
			endsAfter: until,
		},
	};
}

/**
 * What the bookings can tell a contract that is missing details.
 *
 * A contract without a start date, a cost or a cadence never reaches the
 * forecast — two of this owner's three were in exactly that state. The linked
 * recurring payment knows all three, because it was derived from the bookings
 * themselves. Proposing beats guessing: a contract is a document, and a value
 * read off the account is evidence about it, not a replacement for it.
 */
export type ContractCompletion = {
	startDate?: IsoDate;
	costMinor?: number;
	frequency?: ContractCadence;
};

/** The cadences a contract can carry; `custom` cannot be projected. */
export type ContractCadence =
	| "weekly"
	| "biweekly"
	| "monthly"
	| "bimonthly"
	| "quarterly"
	| "semiannual"
	| "yearly"
	| "custom";

export function proposeContractDetails(
	contract: Pick<
		ContractSchedule,
		"startDate" | "costMinor" | "frequency" | "currency"
	>,
	evidence: {
		firstSeen: IsoDate | null;
		amountMinor: number;
		frequency: ContractCadence;
		currency: string;
	} | null,
): ContractCompletion | null {
	if (!evidence) return null;
	// Two currencies cannot be reconciled into one contract cost.
	if (evidence.currency !== contract.currency) return null;
	const proposal: ContractCompletion = {};
	if (!contract.startDate && evidence.firstSeen)
		proposal.startDate = evidence.firstSeen;
	if (contract.costMinor === null && evidence.amountMinor !== 0)
		proposal.costMinor = Math.abs(evidence.amountMinor);
	if (!contract.frequency) proposal.frequency = evidence.frequency;
	return Object.keys(proposal).length > 0 ? proposal : null;
}
