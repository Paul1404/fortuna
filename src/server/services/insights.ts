import { daysBetween, todayIso } from "@/domain/dates";
import * as accountsSvc from "./accounts";
import * as assetsSvc from "./assets";
import * as contractsSvc from "./contracts";
import * as liabilitiesSvc from "./liabilities";
import {
	currentNetWorth,
	netWorthHistory,
	providerHistoryGap,
} from "./net-worth";
import * as receivablesSvc from "./receivables";
import { getSettings, listFxRates } from "./settings";

type RecapMetric =
	| "net_worth"
	| "assets"
	| "investable"
	| "cash"
	| "liabilities";

export async function recapReport(
	userId: string,
	input: {
		metric: RecapMetric;
		interval: "monthly" | "quarterly" | "yearly";
		months: number;
		mode: "totals" | "change";
	},
) {
	const [history, current] = await Promise.all([
		netWorthHistory(userId, input.months),
		currentNetWorth(userId),
	]);
	const firstMeaningful = history.find(
		(row) => row.totalAssetsMinor !== 0 || row.totalLiabilitiesMinor !== 0,
	);
	const meaningfulHistory = firstMeaningful
		? history.filter((row) => row.date >= firstMeaningful.date)
		: [];
	const stride =
		input.interval === "monthly" ? 1 : input.interval === "quarterly" ? 3 : 12;
	const sampled = meaningfulHistory.filter(
		(_, index) =>
			index % stride === 0 || index === meaningfulHistory.length - 1,
	);
	const value = (row: (typeof history)[number]) =>
		({
			net_worth: row.netWorthMinor,
			assets: row.totalAssetsMinor,
			investable: row.liquidNetWorthMinor,
			cash: row.cashMinor,
			liabilities: row.totalLiabilitiesMinor,
		})[input.metric];
	const points = sampled.map((row, index) => ({
		date: row.date,
		valueMinor:
			input.mode === "change"
				? index > 0
					? value(row) - value(sampled[index - 1])
					: 0
				: value(row),
	}));
	const oldest = meaningfulHistory[0]?.date ?? null;
	const historyDays = oldest ? daysBetween(oldest, current.date) : 0;
	return {
		...input,
		baseCurrency: current.baseCurrency,
		points,
		current,
		// The depot only enters the series on the day it is first read, so the
		// last step is its whole value and "Veränderung" would report it as one.
		providerHistoryGap: providerHistoryGap(current),
		// The period the owner picked is not the period the chart covers: the
		// series starts at the first month with any data, so "10 Jahre" on an
		// eight-month-old dataset is an eight-month change wearing a ten-year
		// label.
		coveredFrom: meaningfulHistory[0]?.date ?? null,
		coveredMonths: meaningfulHistory.length,
		maturity: {
			historyDays,
			chartReady: historyDays >= 7,
			growthReady: historyDays >= 30,
		},
	};
}

/** Newest rate that can convert `currency` into `base`, in either direction. */
function newestRateDate(
	rates: readonly { date: string; base: string; quote: string }[],
	currency: string,
	base: string,
): string | null {
	let newest: string | null = null;
	for (const rate of rates) {
		const pair =
			(rate.base === currency && rate.quote === base) ||
			(rate.base === base && rate.quote === currency);
		if (pair && (!newest || rate.date > newest)) newest = rate.date;
	}
	return newest;
}

function freshness(date: string | null, today: string) {
	if (!date) return { score: 0, state: "missing" as const, ageDays: null };
	const ageDays = Math.max(0, daysBetween(date, today));
	return {
		ageDays,
		score: ageDays <= 7 ? 100 : ageDays <= 30 ? 75 : ageDays <= 90 ? 40 : 10,
		state:
			ageDays <= 7
				? ("current" as const)
				: ageDays <= 30
					? ("aging" as const)
					: ("stale" as const),
	};
}

export async function dataQuality(userId: string) {
	const today = todayIso();
	const [accounts, assets, liabilities, receivables, contracts] =
		await Promise.all([
			accountsSvc.listAccounts(userId),
			assetsSvc.listAssets(userId),
			liabilitiesSvc.listLiabilities(userId),
			receivablesSvc.listReceivables(userId),
			contractsSvc.listContracts(userId),
		]);
	const [settings, rates] = await Promise.all([
		getSettings(userId),
		listFxRates(),
	]);
	const entries = [
		...accounts.map((item) => ({
			id: item.id,
			kind: "account" as const,
			name: item.name,
			...freshness(item.balanceAsOf, today),
		})),
		...assets.map((item) => ({
			id: item.id,
			kind: "asset" as const,
			name: item.name,
			...freshness(item.valuationDate, today),
		})),
		...liabilities.map((item) => ({
			id: item.id,
			kind: "liability" as const,
			name: item.name,
			// A card linked to its account is as fresh as that account; its own
			// date is the day it was created and nothing can move it.
			...freshness(item.owedAsOf, today),
		})),
		...receivables.map((item) => ({
			id: item.id,
			kind: "receivable" as const,
			name: item.name,
			...freshness(item.balanceAsOf, today),
		})),
		// Rates are typed in by hand and nothing expires them, so an old one
		// silently backs every foreign-currency figure while this card reported
		// that everything was current. A currency in use without any rate at all
		// is worse still: its positions are dropped from every total.
		...[
			...new Set(
				[...accounts, ...assets, ...liabilities, ...receivables]
					.map((item) => item.currency)
					.filter((currency) => currency !== settings.baseCurrency),
			),
		].map((currency) => ({
			id: `fx:${currency}`,
			kind: "fxRate" as const,
			name: `Wechselkurs ${currency} → ${settings.baseCurrency}`,
			...freshness(
				newestRateDate(rates, currency, settings.baseCurrency),
				today,
			),
		})),
	];
	const sourceScore = entries.length
		? Math.round(
				entries.reduce((sum, entry) => sum + entry.score, 0) / entries.length,
			)
		: 100;
	const contractScore = contracts.length
		? Math.round(
				contracts.reduce((sum, contract) => sum + contract.completeness, 0) /
					contracts.length,
			)
		: 100;
	return {
		score: Math.round(sourceScore * 0.75 + contractScore * 0.25),
		sourceScore,
		contractScore,
		current: entries.filter((entry) => entry.state === "current").length,
		aging: entries.filter((entry) => entry.state === "aging").length,
		stale: entries.filter((entry) => entry.state === "stale").length,
		missing: entries.filter((entry) => entry.state === "missing").length,
		entries: entries.sort((left, right) => left.score - right.score),
		contracts: contracts
			.filter((contract) => contract.completeness < 100)
			.map((contract) => ({
				id: contract.id,
				name: contract.name,
				completeness: contract.completeness,
				missingFields: contract.missingFields,
			})),
	};
}
