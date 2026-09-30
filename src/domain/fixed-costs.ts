/**
 * Fixkosten: one line per thing the owner pays for regularly.
 *
 * A subscription used to live three times — as the recurring payment that
 * leaves the account, as the contract that says what was agreed, and as the
 * Sparmission that plans to replace it — on three pages, each with its own
 * total. They are one item: the recurring payment is what is actually paid,
 * the contract what was agreed, and the Sparmission a status on both.
 *
 * Nothing here reads a stored status to decide what costs money: the contract
 * arrives with its phase from `src/domain/contract.ts`, and a recurring
 * payment stops at its contract's end.
 */

import { contractMonthlyCostMinor } from "./contract";
import { daysBetween, endOfMonth } from "./dates";
import {
	defaultIntervalDays,
	type Frequency,
	monthlyEquivalentMinor,
} from "./recurring";

export type FixedCostRecurring = {
	id: string;
	name: string;
	direction: "inflow" | "outflow";
	isActive: boolean;
	monthlyEquivalentMinor: number;
	currency: string;
};

export type FixedCostContract = {
	id: string;
	name: string;
	recurringPaymentId: string | null;
	phase: "running" | "cancelled_running" | "ended";
	monthlyCostMinor: number | null;
	bookedMonthlyCostMinor: number | null;
	currency: string;
	/**
	 * `payroll`: paid by the employer through salary conversion
	 * (Entgeltumwandlung). It is shown, but it never leaves a bank account, so
	 * it is no fixed cost of the account. Missing means `account`.
	 */
	paidVia?: "account" | "payroll";
};

/** True for a contract the employer pays out of gross salary. */
export function paidViaPayroll(contract: { paidVia?: string | null }): boolean {
	return contract.paidVia === "payroll";
}

/**
 * Recurring payments that carry a payroll-paid contract. Whatever the owner
 * entered there is paid by the employer, so it is not money leaving the
 * account either: the forecast and the fixed-cost trend leave them out.
 */
export function payrollRecurringIds(
	contracts: readonly {
		paidVia?: string | null;
		recurringPaymentId: string | null;
	}[],
): Set<string> {
	return new Set(
		contracts
			.filter((contract) => paidViaPayroll(contract))
			.flatMap((contract) =>
				contract.recurringPaymentId ? [contract.recurringPaymentId] : [],
			),
	);
}

export type FixedCostMission = {
	id: string;
	title: string;
	recurringPaymentId: string | null;
	contractId: string | null;
	status: "idea" | "planned" | "completed" | "dismissed";
	currentMonthlyMinor: number;
	currency: string;
};

export type FixedCostItem<
	R extends FixedCostRecurring,
	C extends FixedCostContract,
	M extends FixedCostMission,
> = {
	/** Stable across reloads: `r:`, `c:` or `o:` plus the leading record's id. */
	key: string;
	name: string;
	direction: "inflow" | "outflow";
	recurring: R | null;
	contract: C | null;
	/** The Sparmission shown as the item's status; the newest one not dismissed. */
	mission: M | null;
	/** Every Sparmission on the item, the shown one included. */
	missions: M[];
	/** Still costing money: an ended contract ends its payment too. */
	active: boolean;
	/**
	 * What it costs a month, signed like a booking (an outflow is negative):
	 * the booked amount where a payment exists, else the contract's. Null when
	 * neither can be turned into a month.
	 */
	monthlyMinor: number | null;
	currency: string;
	/**
	 * Counted in the page's total — a Sparmission alone is an idea, not a
	 * cost, and a contract paid through the salary never reaches the account.
	 */
	counted: boolean;
	/** Paid by the employer through salary conversion ("über Gehalt"). */
	viaPayroll: boolean;
	/**
	 * Set when the contract and the bookings disagree by more than 1,00; both
	 * as positive monthly amounts.
	 */
	divergence: { agreedMinor: number; bookedMinor: number } | null;
};

/** Tolerance before the agreed and the booked monthly cost count as different. */
export const DIVERGENCE_TOLERANCE_MINOR = 100;

export function groupFixedCosts<
	R extends FixedCostRecurring,
	C extends FixedCostContract,
	M extends FixedCostMission,
>(recurring: R[], contracts: C[], missions: M[]): FixedCostItem<R, C, M>[] {
	const recurringIds = new Set(recurring.map((row) => row.id));
	// A payment has one contract; a second contract naming the same payment
	// keeps its own line rather than disappearing. A running one wins.
	const contractFor = new Map<string, C>();
	for (const contract of [...contracts].sort(
		(a, b) => Number(a.phase === "ended") - Number(b.phase === "ended"),
	)) {
		const paymentId = contract.recurringPaymentId;
		if (paymentId && recurringIds.has(paymentId) && !contractFor.has(paymentId))
			contractFor.set(paymentId, contract);
	}
	const attached = new Set(Array.from(contractFor.values(), (c) => c.id));

	type Draft = { key: string; recurring: R | null; contract: C | null };
	const drafts: Draft[] = [
		...recurring.map((row) => ({
			key: `r:${row.id}`,
			recurring: row,
			contract: contractFor.get(row.id) ?? null,
		})),
		...contracts
			.filter((contract) => !attached.has(contract.id))
			.map((contract) => ({
				key: `c:${contract.id}`,
				recurring: null,
				contract,
			})),
	];
	const missionsFor = new Map<string, M[]>();
	const loose: M[] = [];
	for (const mission of missions) {
		const home = drafts.find(
			(draft) =>
				(mission.recurringPaymentId &&
					draft.recurring?.id === mission.recurringPaymentId) ||
				(mission.contractId && draft.contract?.id === mission.contractId),
		);
		if (!home) loose.push(mission);
		else
			missionsFor.set(home.key, [
				...(missionsFor.get(home.key) ?? []),
				mission,
			]);
	}

	const items: FixedCostItem<R, C, M>[] = drafts.map((draft) => {
		const { recurring: payment, contract } = draft;
		const attachedMissions = missionsFor.get(draft.key) ?? [];
		const contractEnded = contract?.phase === "ended";
		const viaPayroll = contract ? paidViaPayroll(contract) : false;
		const active = payment
			? payment.isActive && !contractEnded
			: !contractEnded;
		const booked =
			contract?.bookedMonthlyCostMinor ??
			(payment?.isActive ? payment.monthlyEquivalentMinor : null);
		const agreed =
			contract && !contractEnded && contract.monthlyCostMinor !== null
				? Math.abs(contract.monthlyCostMinor)
				: null;
		const monthlyMinor =
			payment?.isActive && !contractEnded
				? payment.monthlyEquivalentMinor
				: agreed === null
					? null
					: -agreed;
		return {
			key: draft.key,
			name: contract?.name ?? payment?.name ?? "",
			direction: payment?.direction ?? "outflow",
			recurring: payment,
			contract,
			mission:
				attachedMissions.find((mission) => mission.status !== "dismissed") ??
				null,
			missions: attachedMissions,
			active,
			monthlyMinor: active ? monthlyMinor : null,
			currency: payment?.currency ?? contract?.currency ?? "EUR",
			counted: active && monthlyMinor !== null && !viaPayroll,
			viaPayroll,
			divergence:
				agreed !== null &&
				booked !== null &&
				Math.abs(Math.abs(booked) - agreed) > DIVERGENCE_TOLERANCE_MINOR
					? { agreedMinor: agreed, bookedMinor: Math.abs(booked) }
					: null,
		};
	});
	for (const mission of loose)
		items.push({
			key: `o:${mission.id}`,
			name: mission.title,
			direction: "outflow",
			recurring: null,
			contract: null,
			mission: mission.status === "dismissed" ? null : mission,
			missions: [mission],
			active: mission.status !== "dismissed",
			monthlyMinor:
				mission.status === "dismissed" ? null : -mission.currentMonthlyMinor,
			currency: mission.currency,
			counted: false,
			viaPayroll: false,
			divergence: null,
		});
	return items.sort(
		(a, b) =>
			Number(b.active) - Number(a.active) ||
			Number(b.counted) - Number(a.counted) ||
			Math.abs(b.monthlyMinor ?? 0) - Math.abs(a.monthlyMinor ?? 0) ||
			a.name.localeCompare(b.name, "de"),
	);
}

/* ── Fixed costs over time ─────────────────────────────────────────────── */

export type FixedCostHistoryPayment = {
	id: string;
	frequency: string;
	intervalDays: number | null;
	/** Booked outflows linked to the payment, already in one currency. */
	bookings: readonly { bookingDate: string; amountMinor: number }[];
};

export type FixedCostHistoryContract = Parameters<
	typeof contractMonthlyCostMinor
>[0] & {
	recurringPaymentId: string | null;
	paidVia?: string | null;
};

/**
 * What the fixed costs were in each month, with the definitions of the
 * Fixkosten page: every recurring outflow at what it was really charged, plus
 * every contract that no recurring payment carries, at its agreed cost.
 *
 * A payment counts in a month while its latest booking by that month's end is
 * no older than its cadence allows (half an interval of slack), converted to
 * a month, so a yearly premium is a twelfth every month rather than a spike.
 * Contracts paid through the salary, and payments carrying one, are no cost
 * of the account and are left out. Amounts are positive.
 */
export function monthlyFixedCostSeries(
	months: readonly string[],
	payments: readonly FixedCostHistoryPayment[],
	contracts: readonly FixedCostHistoryContract[],
	carriedPaymentIds: ReadonlySet<string>,
): { month: string; fixedCostsMinor: number }[] {
	const payroll = payrollRecurringIds(contracts);
	return months.map((month) => {
		const monthEnd = endOfMonth(`${month}-01`);
		let total = 0;
		for (const payment of payments) {
			if (payroll.has(payment.id)) continue;
			const frequency = payment.frequency as Frequency;
			const interval =
				payment.intervalDays ?? defaultIntervalDays(frequency) ?? 30;
			let latest: { bookingDate: string; amountMinor: number } | null = null;
			for (const booking of payment.bookings)
				if (
					booking.bookingDate <= monthEnd &&
					(!latest || booking.bookingDate > latest.bookingDate)
				)
					latest = booking;
			if (!latest) continue;
			if (
				daysBetween(latest.bookingDate, monthEnd) > Math.round(interval * 1.5)
			)
				continue;
			total += Math.abs(
				monthlyEquivalentMinor(latest.amountMinor, frequency, interval),
			);
		}
		for (const contract of contracts) {
			if (paidViaPayroll(contract)) continue;
			// Carried by a recurring payment: its bookings are counted above.
			if (
				contract.recurringPaymentId &&
				carriedPaymentIds.has(contract.recurringPaymentId)
			)
				continue;
			// Unknown before it started; `contractMonthlyCostMinor` treats a
			// contract without a start as always running, which is a constant
			// and cannot fake a trend.
			total += Math.abs(contractMonthlyCostMinor(contract, monthEnd) ?? 0);
		}
		return { month, fixedCostsMinor: total };
	});
}
