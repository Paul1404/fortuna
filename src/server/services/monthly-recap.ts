import { ORPCError } from "@orpc/server";
import { and, eq, gte, lt, min, ne } from "drizzle-orm";
import { addMonths, endOfMonth, todayIso } from "@/domain/dates";
import {
	composeMonthlyRecap,
	type MonthlyRecap,
	monthCovered,
	previousMonth,
} from "@/domain/monthly-recap";
import { db } from "@/server/db";
import {
	deskRecapReads,
	financialObservations,
	transactions,
} from "@/server/db/schema";
import { cashflowReport } from "./cashflow";
import { currentNetWorth, netWorthAt, providerHistoryGap } from "./net-worth";

/**
 * The recap stands on the desk on the first days of a month only: after
 * that it is old news, and the desk is for today. Past recaps stay
 * reachable from "Erledigt und entschieden".
 */
export const RECAP_VISIBLE_DAYS = 10;

/** The last full month before `today`, as `YYYY-MM`. */
export function lastFullMonth(today: string): string {
	return addMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
}

/** The recap of one full month. Throws for the running month or later. */
export async function monthlyRecap(
	userId: string,
	month: string,
	today: string = todayIso(),
): Promise<MonthlyRecap> {
	if (month > lastFullMonth(today))
		throw new ORPCError("BAD_REQUEST", {
			message: "Einen Rückblick gibt es erst nach Monatsende",
		});
	const from = `${month}-01`;
	const to = endOfMonth(from);
	const before = previousMonth(month);
	const [cashflow, firstBooking, observations, start, end, now] =
		await Promise.all([
			// One month, and with it the month before as `previous`.
			cashflowReport(userId, { from, to, months: 1 }),
			db
				.select({ first: min(transactions.bookingDate) })
				.from(transactions)
				.where(
					and(
						eq(transactions.userId, userId),
						eq(transactions.status, "booked"),
					),
				)
				.then((rows) => rows[0]?.first ?? null),
			db
				.select({
					title: financialObservations.title,
					severity: financialObservations.severity,
				})
				.from(financialObservations)
				.where(
					and(
						eq(financialObservations.userId, userId),
						ne(financialObservations.status, "dismissed"),
						gte(
							financialObservations.firstDetectedAt,
							new Date(`${from}T00:00:00Z`),
						),
						lt(
							financialObservations.firstDetectedAt,
							new Date(`${addMonths(from, 1)}T00:00:00Z`),
						),
					),
				),
			netWorthAt(userId, endOfMonth(`${before}-01`)),
			netWorthAt(userId, to),
			currentNetWorth(userId),
		]);
	const figures = cashflow.months[0] ?? {
		incomeMinor: 0,
		expenseMinor: 0,
		netMinor: 0,
		transactionCount: 0,
	};
	const previousCovered =
		monthCovered(before, firstBooking) &&
		cashflow.previousCoverage.monthsWithData > 0;
	const top = cashflow.categories[0];
	const hadHistory =
		start.totalAssetsMinor !== 0 || start.totalLiabilitiesMinor !== 0;
	return composeMonthlyRecap({
		month,
		currency: cashflow.baseCurrency,
		firstBookingDate: firstBooking,
		current: figures,
		previous: previousCovered
			? {
					incomeMinor: cashflow.previous.incomeMinor,
					expenseMinor: cashflow.previous.expenseMinor,
					netMinor: cashflow.previous.netMinor,
				}
			: null,
		topCategory: top ? { name: top.name, amountMinor: top.amountMinor } : null,
		// A connected depot is attached to today's snapshot only, so both
		// month ends leave it out: the change is real, but only without it.
		netWorth: hadHistory
			? {
					startMinor: start.netWorthMinor,
					endMinor: end.netWorthMinor,
					excludesDepot: providerHistoryGap(now),
				}
			: null,
		observations,
	});
}

/**
 * The recap the desk shows: the last full month's, on the first days of the
 * new month, until the owner has read it. Null otherwise, and for an owner
 * without a single booking yet.
 */
export async function deskRecap(
	userId: string,
	today: string = todayIso(),
): Promise<MonthlyRecap | null> {
	if (Number(today.slice(8, 10)) > RECAP_VISIBLE_DAYS) return null;
	const month = lastFullMonth(today);
	const [read, anyBooking] = await Promise.all([
		db.query.deskRecapReads.findFirst({
			where: and(
				eq(deskRecapReads.userId, userId),
				eq(deskRecapReads.month, month),
			),
		}),
		db.query.transactions.findFirst({
			columns: { id: true },
			where: eq(transactions.userId, userId),
		}),
	]);
	if (read || !anyBooking) return null;
	return monthlyRecap(userId, month, today);
}

/** "Gelesen": the recap of `month` leaves the desk for good. Idempotent. */
export async function markRecapRead(
	userId: string,
	month: string,
): Promise<{ month: string }> {
	await db
		.insert(deskRecapReads)
		.values({ userId, month })
		.onConflictDoNothing();
	return { month };
}
