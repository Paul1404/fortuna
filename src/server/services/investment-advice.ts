import {
	type InvestmentPlan,
	planInvestment,
	providerBucketFor,
	type TargetSplit,
} from "@/domain/capital-advice";
import { daysBetween, todayIso, toIsoDate } from "@/domain/dates";
import { transferSource } from "@/domain/desk";
import { computeNetWorth } from "@/domain/net-worth";
import type { Reserve } from "@/domain/reserve";
import { cashflowForecast } from "./forecast";
import { getFinancialProfile, profileTargets, reserveFor } from "./hr-koerner";
import {
	listInvestmentSourceAccounts,
	listInvestmentSourcePositions,
} from "./investment-sources";
import { currentNetWorthInput } from "./net-worth";
import { loadFxTable } from "./settings";

export type InvestmentPlanContext = {
	asOf: string;
	baseCurrency: string;
	bankCashMinor: number;
	brokerCashMinor: number;
	snapshotAt: string | null;
	depotCount: number;
	/** Where a transfer to the depot comes from; null without a fitting account. */
	transferFrom: { id: string; name: string } | null;
	depotLabel: string;
	targets: TargetSplit;
	reserve: Reserve;
	plan: InvestmentPlan;
};

/**
 * "Anlegen": the whole balance sheet, the one reserve and the one target split,
 * run through `planInvestment`. Everything the proposal rests on is loaded here
 * and nowhere else, so the desk, the dialog and the page judge the same numbers.
 * Nothing is written: a buy is placed only through the broker-order dialog.
 */
export async function investmentPlan(
	userId: string,
): Promise<InvestmentPlanContext> {
	const today = todayIso();
	const [profile, worth, forecast, depots, brokerPositions, fx] =
		await Promise.all([
			getFinancialProfile(userId),
			currentNetWorthInput(userId),
			cashflowForecast(userId, { horizonDays: 90 }),
			listInvestmentSourceAccounts(userId),
			listInvestmentSourcePositions(userId),
			loadFxTable(),
		]);
	// The same input `currentNetWorth` computes from, read once.
	const netWorth = computeNetWorth(worth.input);
	const base = netWorth.baseCurrency;
	const reserve = await reserveFor(userId, { profile, baseCurrency: base });
	const toBase = (amount: number, currency: string) => {
		const converted = fx.convert(amount, currency, base, today);
		return converted.missing ? null : converted.amountMinor;
	};

	// Settled cash only. Buying power includes credit, and credit is not
	// capital.
	const brokerCashMinor = depots.reduce(
		(sum, depot) =>
			sum + (toBase(depot.cashBalanceMinor ?? 0, depot.currency) ?? 0),
		0,
	);
	const providerCash = netWorth.providerBreakdown.reduce(
		(sum, row) => sum + row.cashMinor,
		0,
	);
	const bankCashMinor = Math.max(0, netWorth.cashMinor - providerCash);

	const holdings = brokerPositions.flatMap((position) => {
		if (position.valueMinor === null || !position.isin) return [];
		const value = toBase(position.valueMinor, position.currency);
		if (value === null) return [];
		return [
			{
				isin: position.isin,
				name: position.instrumentName ?? position.isin,
				bucket: providerBucketFor(position.assetClass),
				valueMinor: value,
			},
		];
	});

	const snapshot = depots.reduce<Date | null>((oldest, depot) => {
		const at = depot.valuationAt ?? depot.cashValuationAt ?? null;
		return at && (!oldest || at < oldest) ? at : oldest;
	}, null);
	const snapshotAt = snapshot ? toIsoDate(snapshot) : null;
	const targets = profileTargets(profile);

	const source = transferSource(worth.input.accounts, base);
	const plan = planInvestment({
		bankCashMinor,
		brokerCashMinor,
		reserveMinor: reserve.reserveMinor,
		forecastLowestMinor: forecast.lowestPoint?.projectedMinor ?? null,
		forecastLowestDate: forecast.lowestPoint?.date ?? null,
		holdings,
		targets,
		horizonMonths: profile.targetNetWorthDate
			? Math.max(
					0,
					Math.floor(daysBetween(today, profile.targetNetWorthDate) / 30.44),
				)
			: null,
		snapshotAgeDays: snapshotAt ? daysBetween(snapshotAt, today) : null,
		transferLimitMinor: source?.balanceMinor ?? null,
	});

	return {
		asOf: today,
		baseCurrency: base,
		bankCashMinor,
		brokerCashMinor,
		snapshotAt,
		depotCount: depots.length,
		transferFrom: source ? { id: source.id, name: source.name } : null,
		depotLabel: depots.length > 0 ? "Scalable-Depot" : "Depot",
		targets,
		reserve,
		plan,
	};
}
