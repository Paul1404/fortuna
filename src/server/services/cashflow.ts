import { and, eq, gte, lte } from "drizzle-orm";
import {
	type CategoryInfo,
	type MonthlyCashflow,
	monthlyCashflow,
	periodTotals,
	rollingAverage,
	savingsRate,
	spendingByCategory,
} from "@/domain/cashflow";
import { addMonths, endOfMonth, startOfMonth, todayIso } from "@/domain/dates";
import { db } from "@/server/db";
import { categories, transactions } from "@/server/db/schema";
import { getSettings, loadFxTable } from "./settings";

export type CashflowReport = {
	baseCurrency: string;
	from: string;
	to: string;
	months: MonthlyCashflow[];
	rolling3: MonthlyCashflow[];
	totals: {
		incomeMinor: number;
		expenseMinor: number;
		netMinor: number;
		savingsRate: number | null;
	};
	previous: { incomeMinor: number; expenseMinor: number; netMinor: number };
	previousCoverage: { months: number; monthsWithData: number };
	averages: { incomeMinor: number; expenseMinor: number; netMinor: number };
	categories: ReturnType<typeof spendingByCategory>;
	previousCategories: ReturnType<typeof spendingByCategory>;
	unconverted: string[];
};

async function loadCashflowTxs(userId: string, from: string, to: string) {
	const [settings, fx, rows, cats] = await Promise.all([
		getSettings(userId),
		loadFxTable(),
		db
			.select({
				bookingDate: transactions.bookingDate,
				amountMinor: transactions.amountMinor,
				currency: transactions.currency,
				categoryId: transactions.categoryId,
				transferGroupId: transactions.transferGroupId,
				status: transactions.status,
			})
			.from(transactions)
			.where(
				and(
					eq(transactions.userId, userId),
					gte(transactions.bookingDate, from),
					lte(transactions.bookingDate, to),
				),
			),
		db
			.select({
				id: categories.id,
				kind: categories.kind,
				parentId: categories.parentId,
				name: categories.name,
			})
			.from(categories)
			.where(eq(categories.userId, userId)),
	]);
	const unconverted = new Set<string>();
	const converted = rows.map((r) => {
		const c = fx.convert(
			r.amountMinor,
			r.currency,
			settings.baseCurrency,
			r.bookingDate,
		);
		if (c.missing) unconverted.add(r.currency);
		return { ...r, amountMinor: c.missing ? 0 : c.amountMinor };
	});
	const categoryMap = new Map<string, CategoryInfo>(cats.map((c) => [c.id, c]));
	return {
		settings,
		txs: converted,
		categoryMap,
		unconverted: Array.from(unconverted),
	};
}

export async function cashflowReport(
	userId: string,
	input: { from?: string; to?: string; months?: number } = {},
): Promise<CashflowReport> {
	const settings = await getSettings(userId);
	const to = input.to ?? endOfMonth(todayIso());
	const months = input.months ?? settings.analysisMonths;
	const from = input.from ?? startOfMonth(addMonths(to, -(months - 1)));
	const prevTo = endOfMonth(addMonths(from, -1));
	const prevFrom = startOfMonth(addMonths(from, -months));
	const data = await loadCashflowTxs(userId, prevFrom, to);
	const series = monthlyCashflow(data.txs, data.categoryMap, from, to);
	const prevSeries = monthlyCashflow(
		data.txs,
		data.categoryMap,
		prevFrom,
		prevTo,
	);
	const totals = periodTotals(series);
	const n = series.length || 1;
	return {
		baseCurrency: data.settings.baseCurrency,
		from,
		to,
		months: series,
		rolling3: rollingAverage(series, 3),
		totals: {
			...totals,
			savingsRate: savingsRate(totals.incomeMinor, totals.expenseMinor),
		},
		previous: periodTotals(prevSeries),
		// The window before this one can be almost empty — nothing was recorded
		// yet — and then every comparison reads "+1.813,5 %" as if spending had
		// exploded. The page needs to know before it prints a percentage.
		previousCoverage: {
			months: prevSeries.length,
			monthsWithData: prevSeries.filter(
				(month) => month.incomeMinor !== 0 || month.expenseMinor !== 0,
			).length,
		},
		averages: {
			incomeMinor: Math.round(totals.incomeMinor / n),
			expenseMinor: Math.round(totals.expenseMinor / n),
			netMinor: Math.round(totals.netMinor / n),
		},
		categories: spendingByCategory(data.txs, data.categoryMap, from, to),
		previousCategories: spendingByCategory(
			data.txs,
			data.categoryMap,
			prevFrom,
			prevTo,
		),
		unconverted: data.unconverted,
	};
}

export async function spendingForMonth(
	userId: string,
	month: string,
): Promise<{
	categories: ReturnType<typeof spendingByCategory>;
	incomeMinor: number;
	expenseMinor: number;
}> {
	const from = `${month}-01`;
	const to = endOfMonth(from);
	const data = await loadCashflowTxs(userId, from, to);
	const series = monthlyCashflow(data.txs, data.categoryMap, from, to);
	return {
		categories: spendingByCategory(data.txs, data.categoryMap, from, to, {
			rollUp: false,
		}),
		incomeMinor: series[0]?.incomeMinor ?? 0,
		expenseMinor: series[0]?.expenseMinor ?? 0,
	};
}
