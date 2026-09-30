import {
	addDays,
	addMonths,
	daysBetween,
	endOfMonth,
	startOfMonth,
	todayIso,
} from "@/domain/dates";
import { listAccounts } from "./accounts";
import { cashflowReport } from "./cashflow";
import { cashflowForecast } from "./forecast";
import {
	currentNetWorth,
	holdingsBreakdown,
	netWorthAt,
	netWorthHistory,
	providerHistoryGap,
} from "./net-worth";
import { upcomingRecurring } from "./recurring";
import { getSettings } from "./settings";
import { listTransactions } from "./transactions";

export type PeriodDelta = {
	label: string;
	date: string;
	netWorthMinor: number | null;
	assetsMinor: number | null;
	liabilitiesMinor: number | null;
	investableMinor: number | null;
};

/** Annualised growth between two values over `days`; null when not meaningful. */
export function cagr(
	startMinor: number,
	endMinor: number,
	days: number,
): number | null {
	if (startMinor <= 0 || endMinor <= 0 || days < 30) return null;
	const rate = ((endMinor / startMinor) ** (365 / days) - 1) * 100;
	return Number.isFinite(rate) && Math.abs(rate) <= 1000 ? rate : null;
}

export async function dashboard(userId: string) {
	const today = todayIso();
	const yearStart = `${today.slice(0, 4)}-01-01`;
	const [
		settings,
		netWorth,
		history,
		accounts,
		cashflow,
		forecast,
		upcoming,
		recent,
		dayAgo,
		weekAgo,
		monthAgo,
		ytd,
		holdings,
	] = await Promise.all([
		getSettings(userId),
		currentNetWorth(userId),
		netWorthHistory(userId, 12),
		listAccounts(userId),
		cashflowReport(userId, {
			from: startOfMonth(addMonths(today, -5)),
			to: endOfMonth(today),
			months: 6,
		}),
		cashflowForecast(userId, { horizonDays: 90 }),
		upcomingRecurring(userId, 30),
		listTransactions(userId, { limit: 10, includeTransfers: true }),
		netWorthAt(userId, addDays(today, -1)),
		netWorthAt(userId, addDays(today, -7)),
		netWorthAt(userId, addMonths(today, -1)),
		netWorthAt(userId, yearStart),
		holdingsBreakdown(userId),
	]);
	const gap = providerHistoryGap(netWorth);
	const delta = (
		label: string,
		date: string,
		s: typeof netWorth,
	): PeriodDelta => {
		const has =
			!gap && (s.totalAssetsMinor !== 0 || s.totalLiabilitiesMinor !== 0);
		return {
			label,
			date,
			netWorthMinor: has ? netWorth.netWorthMinor - s.netWorthMinor : null,
			assetsMinor: has ? netWorth.totalAssetsMinor - s.totalAssetsMinor : null,
			liabilitiesMinor: has
				? netWorth.totalLiabilitiesMinor - s.totalLiabilitiesMinor
				: null,
			investableMinor: has
				? netWorth.liquidNetWorthMinor - s.liquidNetWorthMinor
				: null,
		};
	};
	const thisMonth = cashflow.months[cashflow.months.length - 1];
	const lastMonth = cashflow.months[cashflow.months.length - 2];
	const first = history.find((h) => h.netWorthMinor !== 0) ?? null;
	const yearAgo = history[0] ?? null;
	const growthDays = first ? daysBetween(first.date, today) : 0;
	return {
		baseCurrency: settings.baseCurrency,
		locale: settings.locale,
		today,
		netWorth,
		history,
		deltas: [
			delta("1 Tag", addDays(today, -1), dayAgo),
			delta("1 Woche", addDays(today, -7), weekAgo),
			delta("1 Monat", addMonths(today, -1), monthAgo),
			delta("Seit Jahresbeginn", yearStart, ytd),
		],
		providerHistoryGap: gap,
		change: {
			monthMinor:
				!gap && (monthAgo.totalAssetsMinor || monthAgo.totalLiabilitiesMinor)
					? netWorth.netWorthMinor - monthAgo.netWorthMinor
					: null,
			yearMinor:
				yearAgo && !gap ? netWorth.netWorthMinor - yearAgo.netWorthMinor : null,
		},
		cagr: {
			netWorth:
				first && !gap
					? cagr(first.netWorthMinor, netWorth.netWorthMinor, growthDays)
					: null,
			investable:
				first && !gap
					? cagr(
							first.liquidNetWorthMinor,
							netWorth.liquidNetWorthMinor,
							growthDays,
						)
					: null,
			sinceDate: first?.date ?? null,
		},
		holdings,
		accounts,
		thisMonth: thisMonth ?? null,
		lastMonth: lastMonth ?? null,
		cashflowMonths: cashflow.months,
		categories: cashflow.categories.slice(0, 6),
		forecast: {
			endBalanceMinor: forecast.endBalanceMinor,
			lowestPoint: forecast.lowestPoint,
			points: forecast.points.filter((_, i) => i % 3 === 0),
			openingBalanceMinor: forecast.openingBalanceMinor,
			horizonDays: forecast.horizonDays,
		},
		upcoming: upcoming.slice(0, 8),
		recent: recent.rows,
		unconverted: Array.from(
			new Set([
				...netWorth.unconvertedCurrencies,
				...cashflow.unconverted,
				...forecast.unconverted,
			]),
		),
	};
}
