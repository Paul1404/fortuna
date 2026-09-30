import { eq, min } from "drizzle-orm";
import { todayIso } from "@/domain/dates";
import {
	type GrowthBreakdown,
	type GrowthPeriod,
	type GrowthWindow,
	growthBreakdown,
	type SavingsStreak,
	savingsStreak,
} from "@/domain/progress";
import { db } from "@/server/db";
import { transactions } from "@/server/db/schema";
import { cashflowReport } from "./cashflow";
import { growthFacts } from "./net-worth";
import { getSettings } from "./settings";

export type NetWorthProgress = {
	baseCurrency: string;
	period: GrowthPeriod;
	/** Null before there is any data to compare. */
	growth: (GrowthBreakdown & { window: GrowthWindow }) | null;
	streak: SavingsStreak;
	/** Currencies the saving could not convert and therefore left out. */
	unconverted: string[];
};

/** Months the streak looks back over; a longer run is shown as this many. */
const STREAK_MONTHS = 36;

/**
 * Vermögen's progress figures: where the change in net worth came from over
 * the chosen period, and the savings streak. Saving is the cashflow report's
 * net for exactly the window net worth is compared over, so the two pages
 * never disagree about what was saved.
 */
export async function netWorthProgress(
	userId: string,
	period: GrowthPeriod,
): Promise<NetWorthProgress> {
	const today = todayIso();
	const [facts, streakCashflow, first, settings] = await Promise.all([
		growthFacts(userId, period),
		cashflowReport(userId, { months: STREAK_MONTHS }),
		db
			.select({ first: min(transactions.bookingDate) })
			.from(transactions)
			.where(eq(transactions.userId, userId))
			.then((rows) => rows[0]?.first ?? null),
		getSettings(userId),
	]);
	const streak = savingsStreak({
		months: streakCashflow.months,
		firstBookingDate: first,
		today,
	});
	if (!facts)
		return {
			baseCurrency: settings.baseCurrency,
			period,
			growth: null,
			streak,
			unconverted: streakCashflow.unconverted,
		};
	const saving = await cashflowReport(userId, {
		from: facts.window.cashflowFrom,
		to: facts.window.endDate,
	});
	return {
		baseCurrency: facts.baseCurrency,
		period,
		growth: {
			window: facts.window,
			...growthBreakdown({
				startNetWorthMinor: facts.startNetWorthMinor,
				endNetWorthMinor: facts.endNetWorthMinor,
				savingMinor: saving.totals.netMinor,
				revaluationMinor: facts.revaluationMinor,
				depot: facts.depot,
			}),
		},
		streak,
		unconverted: [
			...new Set([...saving.unconverted, ...streakCashflow.unconverted]),
		],
	};
}
