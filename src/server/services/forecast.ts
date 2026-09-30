import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { contractCostsUntil, contractForecastEntry } from "@/domain/contract";
import { addMonths, todayIso } from "@/domain/dates";
import { payrollRecurringIds } from "@/domain/fixed-costs";
import {
	buildForecast,
	type ForecastRecurring,
	type ForecastResult,
	irregularDailyNet,
} from "@/domain/forecast";
import { fallbackNextExpected } from "@/domain/recurring";
import { db } from "@/server/db";
import {
	accounts,
	categories,
	contracts,
	recurringPayments,
	transactions,
} from "@/server/db/schema";
import { getSettings, loadFxTable } from "./settings";

export type ForecastReport = ForecastResult & {
	baseCurrency: string;
	startDate: string;
	horizonDays: number;
	openingBalanceMinor: number;
	accountIds: string[];
	/**
	 * Currencies the forecast could not convert into the base currency. Their
	 * balances, payments and history are left out of every figure above, so
	 * the report names them rather than letting the totals look complete.
	 */
	unconverted: string[];
	assumptions: {
		irregularDailyNetMinor: number;
		irregularMonthlyStdMinor: number;
		historyFrom: string;
		historyTo: string;
		recurringCount: number;
		scheduledCount: number;
		/** Contracts the forecast counts because no booking pattern could. */
		contractCount: number;
		/** Contracts it cannot count, and why — never dropped in silence. */
		contractGaps: { name: string; reason: string }[];
	};
};

// A payment-service balance is spendable today, so the forecast counts it.
const LIQUID_TYPES = ["current", "savings", "cash", "wallet"] as const;

export async function cashflowForecast(
	userId: string,
	input: { horizonDays?: number; accountIds?: string[] } = {},
): Promise<ForecastReport> {
	const [settings, fx] = await Promise.all([
		getSettings(userId),
		loadFxTable(),
	]);
	const today = todayIso();
	const horizonDays = input.horizonDays ?? 90;
	const liquid = await db
		.select()
		.from(accounts)
		.where(
			and(
				eq(accounts.userId, userId),
				eq(accounts.isActive, true),
				inArray(accounts.type, [...LIQUID_TYPES]),
			),
		);
	const selected = input.accountIds?.length
		? liquid.filter((a) => input.accountIds?.includes(a.id))
		: liquid;
	const ids = selected.map((a) => a.id);
	const unconverted = new Set<string>();
	const conv = (amount: number, currency: string) => {
		const c = fx.convert(amount, currency, settings.baseCurrency, today);
		if (c.missing) {
			// Nothing is lost by leaving out an empty balance.
			if (amount !== 0) unconverted.add(currency.toUpperCase());
			return 0;
		}
		return c.amountMinor;
	};
	let opening = 0;
	for (const a of selected) opening += conv(a.currentBalanceMinor, a.currency);
	const recurringRows = ids.length
		? await db
				.select({ r: recurringPayments, categoryName: categories.name })
				.from(recurringPayments)
				.leftJoin(categories, eq(categories.id, recurringPayments.categoryId))
				.where(
					and(
						eq(recurringPayments.userId, userId),
						eq(recurringPayments.isActive, true),
						// "Beliebig" is the form's default, and the checkbox beside it
						// promises the row is in the forecast. Matching only on account
						// silently dropped every such row — rent entered without an
						// account was counted on /recurring and never subtracted here.
						or(
							isNull(recurringPayments.accountId),
							inArray(recurringPayments.accountId, ids),
						),
					),
				)
		: [];
	// A provider balance of type "expected" already nets out the pending items
	// known on its reference date, so counting those again as future events
	// would charge them twice. Anything pending after that date is genuinely
	// still to come. Accounts are keyed to their own anchor because each one
	// carries its own balance date.
	const anchorByAccount = new Map(
		selected.map((account) => [account.id, account.balanceAsOf ?? null]),
	);
	const pendingRows = ids.length
		? await db
				.select()
				.from(transactions)
				.where(
					and(
						eq(transactions.userId, userId),
						inArray(transactions.accountId, ids),
						eq(transactions.status, "pending"),
						gte(transactions.bookingDate, today),
					),
				)
		: [];
	const pending = pendingRows.filter((row) => {
		const anchor = anchorByAccount.get(row.accountId);
		return !anchor || row.bookingDate > anchor;
	});
	// A recurring payment that pays a contract stops when that contract does.
	// The contract is the only place the end date lives, and until now nothing
	// outside /contracts read it.
	const contractRows = await db
		.select({
			id: contracts.id,
			name: contracts.name,
			costMinor: contracts.costMinor,
			currency: contracts.currency,
			frequency: contracts.frequency,
			recurringPaymentId: contracts.recurringPaymentId,
			status: contracts.status,
			startDate: contracts.startDate,
			endDate: contracts.endDate,
			cancellationDate: contracts.cancellationDate,
			renewalDate: contracts.renewalDate,
			noticePeriodDays: contracts.noticePeriodDays,
			paidVia: contracts.paidVia,
		})
		.from(contracts)
		.where(eq(contracts.userId, userId));
	// A payment the owner entered for a contract paid through the salary is
	// paid by the employer; it never leaves the account.
	const payrollPaid = payrollRecurringIds(contractRows);
	const contractEndByRecurring = new Map<string, string>();
	for (const contract of contractRows) {
		if (!contract.recurringPaymentId) continue;
		const until = contractCostsUntil(contract);
		if (!until) continue;
		// Several contracts can point at one payment; the last one to stop wins.
		const known = contractEndByRecurring.get(contract.recurringPaymentId);
		if (!known || until > known)
			contractEndByRecurring.set(contract.recurringPaymentId, until);
	}
	// A contract describes a payment detection can never infer: one or two
	// bookings a year give no cadence. It is only added where no recurring
	// payment already carries it, or the same money would be counted twice.
	const contractEntries: ForecastRecurring[] = [];
	const contractGaps: { name: string; reason: string }[] = [];
	const activeRecurringIds = new Set(recurringRows.map(({ r }) => r.id));
	for (const contract of contractRows) {
		const result = contractForecastEntry({
			...contract,
			recurringPaymentId:
				contract.recurringPaymentId &&
				activeRecurringIds.has(contract.recurringPaymentId)
					? contract.recurringPaymentId
					: null,
		});
		if (!result) continue;
		if ("gap" in result) {
			contractGaps.push({ name: contract.name, reason: result.gap });
			continue;
		}
		contractEntries.push({
			id: `contract:${result.entry.contractId}`,
			name: result.entry.name,
			amountMinor: conv(result.entry.amountMinor, result.entry.currency),
			frequency: result.entry.frequency as ForecastRecurring["frequency"],
			intervalDays: result.entry.intervalDays,
			nextExpected: result.entry.nextDue,
			typicalDay: result.entry.typicalDay,
			isActive: true,
			categoryName: "Vertrag",
			endsAfter: result.entry.endsAfter,
		});
	}
	const historyFrom = addMonths(today, -Math.min(settings.analysisMonths, 6));
	const history = ids.length
		? await db
				.select({
					bookingDate: transactions.bookingDate,
					amountMinor: transactions.amountMinor,
					currency: transactions.currency,
					recurringPaymentId: transactions.recurringPaymentId,
					transferGroupId: transactions.transferGroupId,
					categoryKind: categories.kind,
				})
				.from(transactions)
				.leftJoin(categories, eq(categories.id, transactions.categoryId))
				.where(
					and(
						eq(transactions.userId, userId),
						inArray(transactions.accountId, ids),
						eq(transactions.status, "booked"),
						gte(transactions.bookingDate, historyFrom),
						lte(transactions.bookingDate, today),
					),
				)
		: [];
	// Transfers between selected accounts net to zero. Money moved to an
	// account outside the selection (broker, card, PayPal top-up) is filed
	// under a transfer category and left out, exactly as the cashflow report
	// leaves it out; a standing transfer belongs in a recurring payment.
	const irregular = irregularDailyNet(
		history.map((h) => ({
			...h,
			amountMinor: conv(h.amountMinor, h.currency),
		})),
		historyFrom,
		today,
	);
	const result = buildForecast({
		startDate: today,
		horizonDays,
		openingBalanceMinor: opening,
		recurring: recurringRows
			.filter(({ r }) => !payrollPaid.has(r.id))
			.map<ForecastRecurring>(({ r, categoryName }) => ({
				id: r.id,
				name: r.name,
				amountMinor: conv(r.expectedAmountMinor, r.currency),
				frequency: r.frequency,
				intervalDays: r.intervalDays ?? 30,
				nextExpected:
					r.nextExpected ??
					fallbackNextExpected(today, r.frequency, r.typicalDay),
				typicalDay: r.typicalDay,
				isActive: r.isActive,
				categoryName: categoryName ?? null,
				endsAfter: contractEndByRecurring.get(r.id) ?? null,
			}))
			.concat(contractEntries),
		scheduled: pending.map((p) => ({
			id: p.id,
			name: p.merchantName ?? p.description,
			date: p.bookingDate,
			amountMinor: conv(p.amountMinor, p.currency),
			recurringPaymentId: p.recurringPaymentId,
		})),
		irregularDailyNetMinor: irregular.dailyNetMinor,
		irregularMonthlyStdMinor: irregular.monthlyStdMinor,
	});
	return {
		...result,
		baseCurrency: settings.baseCurrency,
		startDate: today,
		horizonDays,
		openingBalanceMinor: opening,
		accountIds: ids,
		unconverted: Array.from(unconverted).sort(),
		assumptions: {
			contractCount: contractEntries.length,
			contractGaps,
			irregularDailyNetMinor: Math.round(irregular.dailyNetMinor),
			irregularMonthlyStdMinor: Math.round(irregular.monthlyStdMinor),
			historyFrom,
			historyTo: today,
			recurringCount: recurringRows.length,
			scheduledCount: pending.length,
		},
	};
}
