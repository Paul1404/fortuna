import { and, asc, eq } from "drizzle-orm";
import { toCsv } from "@/domain/csv";
import { minorToDecimalString } from "@/domain/money";
import { optimizationSavings } from "@/domain/optimization";
import { db } from "@/server/db";
import {
	accounts,
	assets,
	assetValuations,
	categories,
	liabilities,
	liabilityBalances,
	receivableBalances,
	receivables,
	transactions,
} from "@/server/db/schema";
import { netWorthHistory } from "./net-worth";
import { listOptimizations } from "./optimizations";

export async function exportTransactionsCsv(userId: string): Promise<string> {
	const rows = await db
		.select({
			t: transactions,
			account: accounts.name,
			category: categories.name,
		})
		.from(transactions)
		.innerJoin(accounts, eq(accounts.id, transactions.accountId))
		.leftJoin(categories, eq(categories.id, transactions.categoryId))
		.where(eq(transactions.userId, userId))
		.orderBy(asc(transactions.bookingDate), asc(transactions.createdAt));
	return toCsv([
		[
			"id",
			"konto",
			"buchungsdatum",
			"wertstellung",
			"betrag",
			"waehrung",
			"beschreibung",
			"gegenpartei",
			"gegenpartei_iban",
			"haendler",
			"kategorie",
			"typ",
			"status",
			"umbuchungsgruppe",
			"wiederkehrende_zahlung_id",
			"externe_id",
			"importquelle",
			"notizen",
		],
		...rows.map(({ t, account, category }) => [
			t.id,
			account,
			t.bookingDate,
			t.valueDate,
			minorToDecimalString(t.amountMinor),
			t.currency,
			t.description,
			t.counterpartyName,
			t.counterpartyIban,
			t.merchantName,
			category,
			t.type,
			t.status,
			t.transferGroupId,
			t.recurringPaymentId,
			t.externalId,
			t.importSource,
			t.notes,
		]),
	]);
}

export async function exportAssetsCsv(userId: string): Promise<string> {
	const rows = await db
		.select({ a: assets, v: assetValuations })
		.from(assets)
		.leftJoin(assetValuations, eq(assetValuations.assetId, assets.id))
		.where(eq(assets.userId, userId))
		.orderBy(asc(assets.name), asc(assetValuations.date));
	return toCsv([
		[
			"sachwert_id",
			"name",
			"kategorie",
			"waehrung",
			"kaufdatum",
			"kaufpreis",
			"aktueller_wert",
			"bewertungsdatum",
			"verlaufsdatum",
			"verlaufswert",
			"verlaufsquelle",
			"referenz",
			"aktiv",
		],
		...rows.map(({ a, v }) => [
			a.id,
			a.name,
			a.category,
			a.currency,
			a.acquisitionDate,
			a.acquisitionCostMinor === null
				? null
				: minorToDecimalString(a.acquisitionCostMinor),
			minorToDecimalString(a.currentValueMinor),
			a.valuationDate,
			v?.date ?? null,
			v ? minorToDecimalString(v.valueMinor) : null,
			v?.source ?? null,
			a.reference,
			a.isActive ? "ja" : "nein",
		]),
	]);
}

export async function exportLiabilitiesCsv(userId: string): Promise<string> {
	const rows = await db
		.select({ l: liabilities, b: liabilityBalances })
		.from(liabilities)
		.leftJoin(
			liabilityBalances,
			eq(liabilityBalances.liabilityId, liabilities.id),
		)
		.where(eq(liabilities.userId, userId))
		.orderBy(asc(liabilities.name), asc(liabilityBalances.date));
	return toCsv([
		[
			"verbindlichkeit_id",
			"name",
			"typ",
			"kreditgeber",
			"waehrung",
			"urspruenglicher_betrag",
			"aktuelle_restschuld",
			"stand_vom",
			"zinssatz_prozent",
			"monatliche_rate",
			"startdatum",
			"enddatum",
			"verlaufsdatum",
			"verlaufs_restschuld",
			"aktiv",
		],
		...rows.map(({ l, b }) => [
			l.id,
			l.name,
			l.type,
			l.lender,
			l.currency,
			l.originalAmountMinor === null
				? null
				: minorToDecimalString(l.originalAmountMinor),
			minorToDecimalString(l.currentBalanceMinor),
			l.balanceAsOf,
			l.interestRateBps === null ? null : (l.interestRateBps / 100).toFixed(2),
			l.monthlyPaymentMinor === null
				? null
				: minorToDecimalString(l.monthlyPaymentMinor),
			l.startDate,
			l.endDate,
			b?.date ?? null,
			b ? minorToDecimalString(b.balanceMinor) : null,
			l.isActive ? "ja" : "nein",
		]),
	]);
}

export async function exportReceivablesCsv(userId: string): Promise<string> {
	const rows = await db
		.select({ receivable: receivables, balance: receivableBalances })
		.from(receivables)
		.leftJoin(
			receivableBalances,
			eq(receivableBalances.receivableId, receivables.id),
		)
		.where(eq(receivables.userId, userId))
		.orderBy(asc(receivables.name), asc(receivableBalances.date));
	return toCsv([
		[
			"forderung_id",
			"bezeichnung",
			"schuldner",
			"waehrung",
			"urspruenglicher_betrag",
			"aktuell_offen",
			"stand_vom",
			"zinssatz_prozent",
			"erwartete_monatsrate",
			"beginn",
			"faellig_am",
			"bereich",
			"verlaufsdatum",
			"verlaufsbetrag",
			"aktiv",
			"beglichen_am",
			"notizen",
		],
		...rows.map(({ receivable, balance }) => [
			receivable.id,
			receivable.name,
			receivable.debtorName,
			receivable.currency,
			receivable.originalAmountMinor === null
				? null
				: minorToDecimalString(receivable.originalAmountMinor),
			minorToDecimalString(receivable.currentBalanceMinor),
			receivable.balanceAsOf,
			receivable.interestRateBps === null
				? null
				: (receivable.interestRateBps / 100).toFixed(2),
			receivable.monthlyPaymentMinor === null
				? null
				: minorToDecimalString(receivable.monthlyPaymentMinor),
			receivable.startDate,
			receivable.dueDate,
			receivable.section,
			balance?.date ?? null,
			balance ? minorToDecimalString(balance.balanceMinor) : null,
			receivable.isActive ? "ja" : "nein",
			receivable.settledAt,
			receivable.notes,
		]),
	]);
}

export async function exportOptimizationsCsv(userId: string): Promise<string> {
	// The page's own rows: "bis heute gespart" has to wait for a linked old
	// contract to end, exactly as it does on /optimizations. Recomputing it here
	// from the completion date alone exported savings the owner did not have.
	const rows = (await listOptimizations(userId)).sort((a, b) =>
		a.title.localeCompare(b.title, "de"),
	);
	return toCsv([
		[
			"mission_id",
			"titel",
			"bereich",
			"status",
			"waehrung",
			"heute_monatlich",
			"alternative_monatlich",
			"wechselkosten",
			"ersparnis_monatlich",
			"ersparnis_erstes_jahr",
			"ersparnis_drei_jahre",
			"ersparnis_fuenf_jahre",
			"zieldatum",
			"umgesetzt_am",
			"ersparnis_ab",
			"bis_heute_gespart",
			"notizen",
		],
		...rows.map((row) => {
			const savings = optimizationSavings({
				currentMonthlyMinor: row.currentMonthlyMinor,
				alternativeMonthlyMinor: row.alternativeMonthlyMinor,
				oneTimeCostMinor: row.oneTimeCostMinor,
			});
			return [
				row.id,
				row.title,
				row.category,
				row.status,
				row.currency,
				minorToDecimalString(row.currentMonthlyMinor),
				minorToDecimalString(row.alternativeMonthlyMinor),
				minorToDecimalString(row.oneTimeCostMinor),
				minorToDecimalString(savings.monthlyMinor),
				minorToDecimalString(savings.firstYearMinor),
				minorToDecimalString(savings.threeYearsMinor),
				minorToDecimalString(savings.fiveYearsMinor),
				row.targetDate,
				row.completedAt,
				row.progress.savingFrom,
				minorToDecimalString(row.realizedSavingsMinor),
				row.notes,
			];
		}),
	]);
}

export async function exportNetWorthCsv(
	userId: string,
	months = 60,
): Promise<string> {
	const points = await netWorthHistory(userId, months);
	return toCsv([
		[
			"datum",
			"nettovermoegen",
			"gesamtvermoegen",
			"gesamtverbindlichkeiten",
			"liquides_nettovermoegen",
			"liquide_mittel",
			"wertpapiere",
			"sachwerte",
			"forderungen",
		],
		...points.map((p) => [
			p.date,
			minorToDecimalString(p.netWorthMinor),
			minorToDecimalString(p.totalAssetsMinor),
			minorToDecimalString(p.totalLiabilitiesMinor),
			minorToDecimalString(p.liquidNetWorthMinor),
			minorToDecimalString(p.cashMinor),
			minorToDecimalString(p.investmentsMinor),
			minorToDecimalString(p.physicalMinor),
			minorToDecimalString(p.receivablesMinor),
		]),
	]);
}

export { and };
