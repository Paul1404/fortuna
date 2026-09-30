import { ORPCError } from "@orpc/server";
import { and, desc, eq, gte, inArray, isNotNull, lte, min } from "drizzle-orm";
import { splitTotal, type TargetSplit } from "@/domain/capital-advice";
import {
	addDays,
	addMonths,
	endOfMonth,
	monthRange,
	todayIso,
} from "@/domain/dates";
import {
	monthlyFixedCostSeries,
	payrollRecurringIds,
} from "@/domain/fixed-costs";
import {
	detectFinancialObservations,
	estimateGoalDelayDays,
	type FixedCostTrendMonth,
} from "@/domain/hr-koerner";
import { normaliseInvestmentRules } from "@/domain/investment-rules";
import {
	monthlyExpenseBasis,
	type Reserve,
	requiredReserve,
} from "@/domain/reserve";
import { db } from "@/server/db";
import {
	contracts,
	financialObservations,
	financialProfiles,
	financialReviewRuns,
	recurringPayments,
	transactions,
} from "@/server/db/schema";
import { cashflowReport } from "./cashflow";
import { dataQuality } from "./insights";
import { currentNetWorth, netWorthAt, providerHistoryGap } from "./net-worth";
import { listRecurring } from "./recurring";
import { getSettings } from "./settings";

export type FinancialProfile = {
	currency: string;
	minimumCashReserveMinor: number | null;
	/** The one goal: a name, `targetNetWorthMinor` and `targetNetWorthDate`. */
	goalName: string | null;
	targetNetWorthMinor: number | null;
	targetNetWorthDate: string | null;
	monthlySavingsTargetMinor: number | null;
	/** Months of spending the reserve covers; see `requiredReserve`. */
	reserveMonths: number;
	targetEquityBps: number;
	targetBondBps: number;
	targetCashBps: number;
	targetOtherBps: number;
	largePurchaseThresholdMinor: number | null;
	unusualSpendMultiplierBps: number;
	alertSensitivity: "quiet" | "balanced" | "detailed";
	ignoredCategoryIds: string[];
	weeklyReportEnabled: boolean;
};

const defaults: FinancialProfile = {
	currency: "EUR",
	minimumCashReserveMinor: null,
	goalName: null,
	targetNetWorthMinor: null,
	targetNetWorthDate: null,
	monthlySavingsTargetMinor: null,
	reserveMonths: 3,
	targetEquityBps: 7000,
	targetBondBps: 2000,
	targetCashBps: 1000,
	targetOtherBps: 0,
	largePurchaseThresholdMinor: null,
	unusualSpendMultiplierBps: 25000,
	alertSensitivity: "balanced",
	ignoredCategoryIds: [],
	weeklyReportEnabled: true,
};

export async function getFinancialProfile(
	userId: string,
): Promise<FinancialProfile> {
	const row = await db.query.financialProfiles.findFirst({
		where: eq(financialProfiles.userId, userId),
	});
	if (!row)
		return { ...defaults, currency: (await getSettings(userId)).baseCurrency };
	return {
		currency: row.currency,
		minimumCashReserveMinor: row.minimumCashReserveMinor,
		goalName: row.goalName,
		targetNetWorthMinor: row.targetNetWorthMinor,
		targetNetWorthDate: row.targetNetWorthDate,
		monthlySavingsTargetMinor: row.monthlySavingsTargetMinor,
		reserveMonths: row.reserveMonths,
		targetEquityBps: row.targetEquityBps,
		targetBondBps: row.targetBondBps,
		targetCashBps: row.targetCashBps,
		targetOtherBps: row.targetOtherBps,
		largePurchaseThresholdMinor: row.largePurchaseThresholdMinor,
		unusualSpendMultiplierBps: row.unusualSpendMultiplierBps,
		alertSensitivity:
			row.alertSensitivity as FinancialProfile["alertSensitivity"],
		ignoredCategoryIds: row.ignoredCategoryIds,
		weeklyReportEnabled: row.weeklyReportEnabled,
	};
}

/** The owner's target split, in basis points per class. */
export function profileTargets(profile: FinancialProfile): TargetSplit {
	return {
		equity: profile.targetEquityBps,
		bonds: profile.targetBondBps,
		cash: profile.targetCashBps,
		other: profile.targetOtherBps,
	};
}

/**
 * The owner's own investment rules, or null. Kept out of `FinancialProfile`
 * on purpose: that object feeds the Copilot's snapshot and the MCP-readable
 * profile, and these words are for the sale dialog and the owner only.
 */
export async function getInvestmentRules(
	userId: string,
): Promise<{ rules: string | null }> {
	const row = await db.query.financialProfiles.findFirst({
		columns: { investmentRules: true },
		where: eq(financialProfiles.userId, userId),
	});
	return { rules: row?.investmentRules ?? null };
}

export async function updateFinancialProfile(
	userId: string,
	input: Partial<Omit<FinancialProfile, "currency">> & {
		investmentRules?: string | null;
	},
) {
	const patch =
		input.investmentRules === undefined
			? input
			: {
					...input,
					investmentRules: normaliseInvestmentRules(input.investmentRules),
				};
	const [currency, existing] = await Promise.all([
		getSettings(userId).then((settings) => settings.baseCurrency),
		getFinancialProfile(userId),
	]);
	// The split is one decision: a patch that touches it must leave it whole.
	if (
		splitTotal(profileTargets({ ...existing, ...patch })) !== 10_000 &&
		(patch.targetEquityBps !== undefined ||
			patch.targetBondBps !== undefined ||
			patch.targetCashBps !== undefined ||
			patch.targetOtherBps !== undefined)
	)
		throw new ORPCError("BAD_REQUEST", {
			message: "Die Zielaufteilung muss zusammen genau 100 % ergeben",
		});
	await db
		.insert(financialProfiles)
		.values({ userId, currency, ...patch })
		.onConflictDoUpdate({
			target: financialProfiles.userId,
			set: { ...patch, currency, updatedAt: new Date() },
		});
	return getFinancialProfile(userId);
}

/**
 * The reserve, by the one rule in `requiredReserve`: the desk, "Anlegen" and
 * Hr. Körner's observations all ask here. A minimum entered in another
 * currency is left out until the owner enters it again.
 */
export async function reserveFor(
	userId: string,
	known?: { profile?: FinancialProfile; baseCurrency?: string },
): Promise<Reserve> {
	const today = todayIso();
	const [profile, baseCurrency, cashflow, first, recurring] = await Promise.all(
		[
			known?.profile ?? getFinancialProfile(userId),
			known?.baseCurrency ??
				getSettings(userId).then((settings) => settings.baseCurrency),
			cashflowReport(userId, { months: 13 }),
			db
				.select({ first: min(transactions.bookingDate) })
				.from(transactions)
				.where(eq(transactions.userId, userId))
				.then((rows) => rows[0]?.first ?? null),
			listRecurring(userId),
		],
	);
	const recurringMonthlyMinor = recurring
		.filter(
			(row) => row.direction === "outflow" && row.currency === baseCurrency,
		)
		.reduce((sum, row) => sum + Math.abs(row.monthlyEquivalentMinor), 0);
	return requiredReserve({
		basis: monthlyExpenseBasis({
			months: cashflow.months,
			firstBookingDate: first,
			today,
			recurringMonthlyMinor,
		}),
		reserveMonths: profile.reserveMonths,
		minimumReserveMinor:
			profile.currency === baseCurrency
				? profile.minimumCashReserveMinor
				: null,
		currency: baseCurrency,
	});
}

/** How far back the fixed-cost trend looks: a year-on-year quarter and some. */
const TREND_MONTHS = 18;

/**
 * Fixed costs and income for every full month the owner's data covers, in
 * base currency, for the lifestyle-creep rule. The month of the first booking
 * is never full, so it is left out; so is the running month. Fixed costs use
 * the Fixkosten definitions (`monthlyFixedCostSeries`); income is the
 * cashflow report's.
 */
export async function fixedCostTrend(
	userId: string,
	today: string,
	baseCurrency: string,
): Promise<{
	months: FixedCostTrendMonth[];
	payrollPaymentIds: Set<string>;
}> {
	const [firstBooking, contractRows, paymentRows] = await Promise.all([
		db
			.select({ first: min(transactions.bookingDate) })
			.from(transactions)
			.where(
				and(eq(transactions.userId, userId), eq(transactions.status, "booked")),
			)
			.then((rows) => rows[0]?.first ?? null),
		db
			.select({
				recurringPaymentId: contracts.recurringPaymentId,
				paidVia: contracts.paidVia,
				costMinor: contracts.costMinor,
				currency: contracts.currency,
				frequency: contracts.frequency,
				status: contracts.status,
				startDate: contracts.startDate,
				endDate: contracts.endDate,
				cancellationDate: contracts.cancellationDate,
				renewalDate: contracts.renewalDate,
				noticePeriodDays: contracts.noticePeriodDays,
			})
			.from(contracts)
			.where(eq(contracts.userId, userId)),
		db
			.select({
				id: recurringPayments.id,
				direction: recurringPayments.direction,
				currency: recurringPayments.currency,
				frequency: recurringPayments.frequency,
				intervalDays: recurringPayments.intervalDays,
			})
			.from(recurringPayments)
			.where(eq(recurringPayments.userId, userId)),
	]);
	const payrollPaymentIds = payrollRecurringIds(contractRows);
	const lastFull = endOfMonth(addMonths(today, -1));
	if (!firstBooking) return { months: [], payrollPaymentIds };
	const firstFull = addMonths(`${firstBooking.slice(0, 7)}-01`, 1);
	const from =
		firstFull > addMonths(`${lastFull.slice(0, 7)}-01`, -(TREND_MONTHS - 1))
			? firstFull
			: addMonths(`${lastFull.slice(0, 7)}-01`, -(TREND_MONTHS - 1));
	if (from > lastFull) return { months: [], payrollPaymentIds };
	const months = monthRange(from, lastFull);

	const outflows = paymentRows.filter(
		(row) => row.direction === "outflow" && row.currency === baseCurrency,
	);
	const bookings = outflows.length
		? await db
				.select({
					recurringPaymentId: transactions.recurringPaymentId,
					bookingDate: transactions.bookingDate,
					amountMinor: transactions.amountMinor,
				})
				.from(transactions)
				.where(
					and(
						eq(transactions.userId, userId),
						eq(transactions.status, "booked"),
						eq(transactions.currency, baseCurrency),
						isNotNull(transactions.recurringPaymentId),
						inArray(
							transactions.recurringPaymentId,
							outflows.map((row) => row.id),
						),
						// A yearly payment booked up to 18 months before the window
						// still counts in its first months.
						gte(transactions.bookingDate, addMonths(from, -18)),
						lte(transactions.bookingDate, lastFull),
					),
				)
		: [];
	const bookingsFor = new Map<
		string,
		{ bookingDate: string; amountMinor: number }[]
	>();
	for (const row of bookings) {
		if (!row.recurringPaymentId) continue;
		bookingsFor.set(row.recurringPaymentId, [
			...(bookingsFor.get(row.recurringPaymentId) ?? []),
			row,
		]);
	}
	const fixed = monthlyFixedCostSeries(
		months,
		outflows.map((row) => ({
			id: row.id,
			frequency: row.frequency,
			intervalDays: row.intervalDays,
			bookings: bookingsFor.get(row.id) ?? [],
		})),
		contractRows.filter((row) => row.currency === baseCurrency),
		new Set(paymentRows.map((row) => row.id)),
	);
	const cashflow = await cashflowReport(userId, {
		from,
		to: lastFull,
		months: months.length,
	});
	const income = new Map(
		cashflow.months.map((row) => [row.month, row.incomeMinor]),
	);
	return {
		months: fixed.map((row) => ({
			month: row.month,
			fixedCostsMinor: row.fixedCostsMinor,
			incomeMinor: income.get(row.month) ?? 0,
		})),
		payrollPaymentIds,
	};
}

export async function listObservations(userId: string) {
	return db
		.select()
		.from(financialObservations)
		.where(eq(financialObservations.userId, userId))
		.orderBy(desc(financialObservations.lastDetectedAt))
		.limit(200);
}

export async function updateObservation(
	userId: string,
	input: {
		id: string;
		status: "dismissed" | "intentional" | "snoozed" | "open";
		snoozedUntil?: Date | null;
	},
) {
	if (
		input.status === "snoozed" &&
		(!input.snoozedUntil || input.snoozedUntil <= new Date())
	)
		throw new ORPCError("BAD_REQUEST", {
			message: "Bitte ein künftiges Datum wählen",
		});
	const [row] = await db
		.update(financialObservations)
		.set({
			status: input.status,
			dismissedAt:
				input.status === "dismissed" || input.status === "intentional"
					? new Date()
					: null,
			snoozedUntil: input.status === "snoozed" ? input.snoozedUntil : null,
			resolvedAt: null,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(financialObservations.userId, userId),
				eq(financialObservations.id, input.id),
			),
		)
		.returning();
	if (!row)
		throw new ORPCError("NOT_FOUND", { message: "Beobachtung nicht gefunden" });
	return row;
}

const running = new Map<
	string,
	Promise<{ attempted: boolean; created: number }>
>();

/** Authenticated-visit review, coalesced in-process and throttled across instances. */
export function reviewDue(userId: string, force = false) {
	const existing = running.get(userId);
	if (existing) return existing;
	const promise = performReview(userId, force).finally(() =>
		running.delete(userId),
	);
	running.set(userId, promise);
	return promise;
}

async function performReview(userId: string, force: boolean) {
	const now = new Date();
	const run = await db.query.financialReviewRuns.findFirst({
		where: eq(financialReviewRuns.userId, userId),
	});
	if (
		!force &&
		run?.lastAttemptedAt &&
		now.getTime() - run.lastAttemptedAt.getTime() < 6 * 60 * 60 * 1000
	)
		return { attempted: false, created: 0 };
	await db
		.insert(financialReviewRuns)
		.values({ userId, lastAttemptedAt: now })
		.onConflictDoUpdate({
			target: financialReviewRuns.userId,
			set: { lastAttemptedAt: now },
		});
	try {
		const today = todayIso(now);
		const [profile, settings, worth, recurring, quality, txRows] =
			await Promise.all([
				getFinancialProfile(userId),
				getSettings(userId),
				currentNetWorth(userId),
				listRecurring(userId),
				dataQuality(userId),
				db
					.select({
						id: transactions.id,
						bookingDate: transactions.bookingDate,
						amountMinor: transactions.amountMinor,
						currency: transactions.currency,
						merchantName: transactions.merchantName,
						categoryId: transactions.categoryId,
						transferGroupId: transactions.transferGroupId,
						status: transactions.status,
					})
					.from(transactions)
					.where(
						and(
							eq(transactions.userId, userId),
							gte(transactions.bookingDate, addDays(today, -90)),
							lte(transactions.bookingDate, today),
						),
					)
					.orderBy(desc(transactions.bookingDate))
					.limit(2000),
			]);
		const [reserve, trend] = await Promise.all([
			reserveFor(userId, {
				profile,
				baseCurrency: settings.baseCurrency,
			}),
			fixedCostTrend(userId, today, settings.baseCurrency),
		]);
		const candidates = detectFinancialObservations({
			today,
			baseCurrency: settings.baseCurrency,
			cashMinor: worth.cashMinor,
			reserveMinor: reserve.reserveMinor,
			profile,
			transactions: txRows,
			// Paid by the employer through the salary: nothing to warn about
			// before it lands, because it never lands on the account.
			recurring: recurring.filter(
				(row) => !trend.payrollPaymentIds.has(row.id),
			),
			fixedCostTrend: trend.months,
			staleValuations: quality.entries.filter(
				(entry) =>
					entry.kind === "asset" &&
					(entry.ageDays === null ||
						entry.ageDays >
							(profile.alertSensitivity === "detailed" ? 14 : 30)),
			),
		}).filter(
			(item) =>
				profile.alertSensitivity !== "quiet" ||
				item.severity === "urgent" ||
				item.severity === "review",
		);
		const existing = await db
			.select()
			.from(financialObservations)
			.where(eq(financialObservations.userId, userId));
		const byKey = new Map(existing.map((row) => [row.key, row]));
		let created = 0;
		for (const item of candidates) {
			const previous = byKey.get(item.key);
			if (!previous) {
				await db
					.insert(financialObservations)
					.values({ userId, ...item })
					.onConflictDoNothing();
				created++;
				continue;
			}
			// Owner decisions are durable. A snoozed finding returns only after its deadline.
			if (previous.status === "dismissed" || previous.status === "intentional")
				continue;
			if (
				previous.status === "snoozed" &&
				previous.snoozedUntil &&
				previous.snoozedUntil > now
			)
				continue;
			await db
				.update(financialObservations)
				.set({
					...item,
					status: "open",
					lastDetectedAt: now,
					resolvedAt: null,
					snoozedUntil: null,
					updatedAt: now,
				})
				.where(
					and(
						eq(financialObservations.userId, userId),
						eq(financialObservations.id, previous.id),
					),
				);
		}
		const activeKeys = candidates.map((item) => item.key);
		const missing = existing
			.filter((row) => row.status === "open" && !activeKeys.includes(row.key))
			.map((row) => row.id);
		if (missing.length)
			await db
				.update(financialObservations)
				.set({ status: "resolved", resolvedAt: now, updatedAt: now })
				.where(
					and(
						eq(financialObservations.userId, userId),
						inArray(financialObservations.id, missing),
					),
				);
		await db
			.update(financialReviewRuns)
			.set({ lastSucceededAt: now, lastErrorClass: null })
			.where(eq(financialReviewRuns.userId, userId));
		return { attempted: true, created };
	} catch (error) {
		await db
			.update(financialReviewRuns)
			.set({
				lastErrorClass:
					error instanceof Error ? error.name.slice(0, 80) : "UnknownError",
			})
			.where(eq(financialReviewRuns.userId, userId));
		throw error;
	}
}

export async function weeklyReport(userId: string) {
	const today = todayIso();
	const [reserve, current, weekAgo, cashflow, weeklyCashflow, observations] =
		await Promise.all([
			reserveFor(userId),
			currentNetWorth(userId),
			netWorthAt(userId, addDays(today, -7)),
			cashflowReport(userId, { months: 3 }),
			cashflowReport(userId, {
				from: addDays(today, -6),
				to: today,
				months: 1,
			}),
			listObservations(userId),
		]);
	const active = observations.filter((row) => row.status === "open");
	return {
		asOf: today,
		baseCurrency: current.baseCurrency,
		netWorthMinor: current.netWorthMinor,
		// A depot enters the history only on the day it is first read, so the
		// week-on-week figure would announce its whole value as a gain.
		netWorthChangeMinor:
			!providerHistoryGap(current) &&
			(weekAgo.totalAssetsMinor !== 0 || weekAgo.totalLiabilitiesMinor !== 0)
				? current.netWorthMinor - weekAgo.netWorthMinor
				: null,
		cashMinor: current.cashMinor,
		// The one reserve rule; a minimum entered in an earlier base currency
		// is left out of it rather than relabelled.
		reserveMinor: reserve.reserveMinor,
		weeklyIncomeMinor: weeklyCashflow.totals.incomeMinor,
		weeklyExpenseMinor: weeklyCashflow.totals.expenseMinor,
		weeklyNetMinor: weeklyCashflow.totals.netMinor,
		monthlyCashflow: cashflow.months.at(-1) ?? null,
		observationCount: active.length,
		topObservations: active
			.slice(0, 3)
			.map((row) => ({ id: row.id, title: row.title, severity: row.severity })),
	};
}

export async function reviewHealth(userId: string) {
	return (
		(await db.query.financialReviewRuns.findFirst({
			where: eq(financialReviewRuns.userId, userId),
		})) ?? null
	);
}

/** Counterfactual cash purchase. Does not assume a purchased asset is worthless. */
export async function estimatePurchaseImpact(
	userId: string,
	input: { amountMinor: number; currency: string },
) {
	const [profile, worth, reserve] = await Promise.all([
		getFinancialProfile(userId),
		currentNetWorth(userId),
		reserveFor(userId),
	]);
	if (
		input.currency !== worth.baseCurrency ||
		profile.currency !== worth.baseCurrency
	)
		return {
			available: false as const,
			reason: "currency_mismatch" as const,
			baseCurrency: worth.baseCurrency,
		};
	const cashAfterMinor = worth.cashMinor - input.amountMinor;
	const reserveShortfallMinor =
		reserve.reserveMinor === null
			? null
			: Math.max(0, reserve.reserveMinor - cashAfterMinor);
	const goalConfigured =
		profile.targetNetWorthMinor !== null &&
		profile.targetNetWorthMinor > worth.netWorthMinor &&
		profile.targetNetWorthDate !== null &&
		profile.targetNetWorthDate > todayIso();
	const goalDelayDays = goalConfigured
		? estimateGoalDelayDays(
				input.amountMinor,
				profile.monthlySavingsTargetMinor,
			)
		: null;
	return {
		available: true as const,
		assumption: "full_cash_expense_without_retained_asset_value" as const,
		baseCurrency: worth.baseCurrency,
		purchaseMinor: input.amountMinor,
		cashBeforeMinor: worth.cashMinor,
		cashAfterMinor,
		reserveShortfallMinor,
		goalDelayDays,
		goalDelayIsEstimate: goalDelayDays !== null,
		note: "Ein gekaufter Vermögenswert kann einen Gegenwert haben. Ohne dokumentierten Wiederverkaufswert wird kein Nettovermögenseffekt behauptet.",
	};
}
