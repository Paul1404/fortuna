import { and, asc, eq, inArray } from "drizzle-orm";
import {
	addMonths,
	endOfMonth,
	minIso,
	monthRange,
	todayIso,
} from "@/domain/dates";
import { preferredSourceAccounts } from "@/domain/investment-source";
import {
	assetCategoryLabel,
	computeNetWorth,
	type NetWorthBreakdown,
	type NetWorthInput,
	valueAt,
} from "@/domain/net-worth";
import {
	assetRevaluationMinor,
	type GrowthPeriod,
	type GrowthWindow,
	growthWindow,
	netBrokerDepositsMinor,
} from "@/domain/progress";
import { db } from "@/server/db";
import {
	accountBalances,
	accounts,
	assets,
	assetValuations,
	investmentSourceAccounts,
	investmentSourcePositions,
	investmentSourceTransactions,
	liabilities,
	liabilityBalances,
	receivableBalances,
	receivables,
	transactions,
} from "@/server/db/schema";
import { getSettings, loadFxTable } from "./settings";

type Loaded = Awaited<ReturnType<typeof loadHistories>>;

async function loadHistories(userId: string) {
	const [
		settings,
		fx,
		accountRows,
		balanceRows,
		assetRows,
		valuationRows,
		liabilityRows,
		liabilityBalanceRows,
		receivableRows,
		receivableBalanceRows,
		providerAccountRows,
		providerPositionRows,
		txRows,
	] = await Promise.all([
		getSettings(userId),
		loadFxTable(),
		db
			.select()
			.from(accounts)
			// Deactivating an account removes it from /accounts and from that
			// page's "Summe", and assets and receivables have always been dropped
			// from net worth the same way. Accounts were the exception: the money
			// vanished from one screen and stayed in the other, and the account's
			// own page still answered "Im Nettovermögen: Ja".
			.where(
				and(
					eq(accounts.userId, userId),
					eq(accounts.includeInNetWorth, true),
					eq(accounts.isActive, true),
				),
			),
		db
			.select({
				accountId: accountBalances.accountId,
				date: accountBalances.date,
				balanceMinor: accountBalances.balanceMinor,
			})
			.from(accountBalances)
			.innerJoin(accounts, eq(accounts.id, accountBalances.accountId))
			.where(eq(accounts.userId, userId))
			.orderBy(asc(accountBalances.date)),
		db.select().from(assets).where(eq(assets.userId, userId)),
		db
			.select({
				assetId: assetValuations.assetId,
				date: assetValuations.date,
				valueMinor: assetValuations.valueMinor,
			})
			.from(assetValuations)
			.innerJoin(assets, eq(assets.id, assetValuations.assetId))
			.where(eq(assets.userId, userId))
			.orderBy(asc(assetValuations.date)),
		db.select().from(liabilities).where(eq(liabilities.userId, userId)),
		db
			.select({
				liabilityId: liabilityBalances.liabilityId,
				date: liabilityBalances.date,
				balanceMinor: liabilityBalances.balanceMinor,
			})
			.from(liabilityBalances)
			.innerJoin(liabilities, eq(liabilities.id, liabilityBalances.liabilityId))
			.where(eq(liabilities.userId, userId))
			.orderBy(asc(liabilityBalances.date)),
		db.select().from(receivables).where(eq(receivables.userId, userId)),
		db
			.select({
				receivableId: receivableBalances.receivableId,
				date: receivableBalances.date,
				balanceMinor: receivableBalances.balanceMinor,
			})
			.from(receivableBalances)
			.innerJoin(
				receivables,
				eq(receivables.id, receivableBalances.receivableId),
			)
			.where(eq(receivables.userId, userId))
			.orderBy(asc(receivableBalances.date)),
		db
			.select()
			.from(investmentSourceAccounts)
			.where(eq(investmentSourceAccounts.userId, userId)),
		db
			.select()
			.from(investmentSourcePositions)
			.where(eq(investmentSourcePositions.userId, userId)),
		db
			.select({
				accountId: transactions.accountId,
				date: transactions.bookingDate,
				amountMinor: transactions.amountMinor,
			})
			.from(transactions)
			.where(
				and(eq(transactions.userId, userId), eq(transactions.status, "booked")),
			),
	]);
	const group = <T extends { [K in Key]: string }, Key extends keyof T>(
		rows: T[],
		key: Key,
	) => {
		const map = new Map<string, T[]>();
		for (const r of rows) {
			const list = map.get(r[key]) ?? [];
			list.push(r);
			map.set(r[key], list);
		}
		return map;
	};
	return {
		settings,
		fx,
		accountRows,
		balancesByAccount: group(balanceRows, "accountId"),
		txByAccount: group(txRows, "accountId"),
		assetRows,
		valuationsByAsset: group(valuationRows, "assetId"),
		liabilityRows,
		balancesByLiability: group(liabilityBalanceRows, "liabilityId"),
		receivableRows,
		balancesByReceivable: group(receivableBalanceRows, "receivableId"),
		providerAccountRows,
		providerPositionRows,
	};
}

/**
 * Account balance at a date: the closest observation, adjusted by the
 * transactions between that observation and the date. This lets a single
 * opening balance plus a transaction history yield a full balance curve.
 */
function accountBalanceAt(
	data: Loaded,
	account: Loaded["accountRows"][number],
	date: string,
): number {
	const recorded = data.balancesByAccount.get(account.id) ?? [];
	// A bank that could not report its balance leaves no observation; the row's
	// own balance and date are then the one anchor the bookings walk from.
	const observations = recorded.length
		? recorded
		: [
				{
					date: account.balanceAsOf ?? todayIso(),
					balanceMinor: account.currentBalanceMinor,
				},
			];
	const txs = data.txByAccount.get(account.id) ?? [];
	const before = valueAt(observations, date);
	if (before) {
		let v = before.balanceMinor;
		for (const t of txs)
			if (t.date > before.date && t.date <= date) v += t.amountMinor;
		return v;
	}
	// No observation before the date: walk back from the earliest one after it.
	const after = observations.find((o) => o.date > date);
	if (after) {
		let v = after.balanceMinor;
		for (const t of txs)
			if (t.date > date && t.date <= after.date) v -= t.amountMinor;
		return v;
	}
	return account.currentBalanceMinor;
}

/**
 * The first day an account is known to have held money: the earliest of the
 * day it was created, its first balance observation and its first booked
 * transaction (except for a wallet, see below). A bank connected today
 * arrives with months of bookings, and those months are reconstructed from
 * them, exactly as the account's own balance history is; counting the
 * account only from its creation day made every earlier month-end read as if
 * the money had not existed.
 */
function accountKnownFrom(
	data: Loaded,
	account: Loaded["accountRows"][number],
): string {
	let first = account.createdAt.toISOString().slice(0, 10);
	const observation = data.balancesByAccount.get(account.id)?.[0]?.date;
	if (observation && observation < first) first = observation;
	// A wallet's ledger is not complete: PayPal reports only its outgoing
	// payments over PSD2, never the funding coming in, so walking back from
	// today's balance over its bookings invents money that was never there.
	if (account.type === "wallet") return first;
	for (const t of data.txByAccount.get(account.id) ?? [])
		if (t.date < first) first = t.date;
	return first;
}

function snapshotAt(data: Loaded, date: string): NetWorthBreakdown {
	return computeNetWorth(snapshotInputAt(data, date));
}

/**
 * The exact input today's net worth is computed from, with the few facts a
 * reader of the individual holdings needs beside it. The desk sorts these
 * same holdings by how quickly they become money, so its totals reconcile
 * with the asset side of `currentNetWorth` by construction, not by a second
 * reading of the tables.
 */
export async function currentNetWorthInput(userId: string): Promise<{
	input: NetWorthInput;
	assetSyncSources: Map<string, string | null>;
	receivableDueDates: Map<string, string | null>;
}> {
	const data = await loadHistories(userId);
	return {
		input: snapshotInputAt(data, todayIso()),
		assetSyncSources: new Map(data.assetRows.map((a) => [a.id, a.syncSource])),
		receivableDueDates: new Map(
			data.receivableRows.map((r) => [r.id, r.dueDate]),
		),
	};
}

function snapshotInputAt(data: Loaded, date: string): NetWorthInput {
	// Provider snapshots are current observations, not a reconstructed historical
	// price series. Do not back-cast today's broker valuation into prior months.
	const providerAccounts =
		date === todayIso()
			? (() => {
					const eligible = preferredSourceAccounts(
						data.providerAccountRows.filter((a) => a.provider === "scalable"),
						(accountId) =>
							data.providerPositionRows.some(
								(p) => p.accountId === accountId && p.valueMinor !== null,
							),
						(accountId) =>
							data.providerPositionRows.some((p) => p.accountId === accountId),
					);
					return eligible.map((a) => ({
						id: a.id,
						provider: "Scalable Capital",
						method: a.method,
						linkedAccountId: a.linkedAccountId,
						currency: a.currency,
						cashBalanceMinor: a.cashBalanceMinor,
						cashValuationAt: a.cashValuationAt?.toISOString() ?? null,
						portfolioValueMinor: a.portfolioValueMinor,
						portfolioValuationAt: a.portfolioValuationAt?.toISOString() ?? null,
						holdings: data.providerPositionRows
							.filter((p) => p.accountId === a.id)
							.map((p) => ({
								id: p.id,
								name: p.instrumentName,
								isin: p.isin,
								valueMinor: p.valueMinor,
								currency: p.currency,
								valuationAt: p.valuationAt?.toISOString() ?? null,
								confidence: (p.verification === "inferred"
									? "estimated"
									: "provider_reported") as "estimated" | "provider_reported",
							})),
					}));
				})()
			: [];
	return {
		date,
		baseCurrency: data.settings.baseCurrency,
		fx: data.fx,
		accounts: data.accountRows
			.filter((a) => accountKnownFrom(data, a) <= date)
			.map((a) => ({
				id: a.id,
				name: a.name,
				type: a.type,
				currency: a.currency,
				balanceMinor: accountBalanceAt(data, a, date),
				includeInNetWorth: a.includeInNetWorth,
			})),
		// Hand-entered securities were removed in 0.59.0; the broker depot
		// arrives as `providerAccounts`.
		positions: [],
		providerAccounts,
		assets: data.assetRows
			.filter(
				(a) =>
					(!a.disposedAt || a.disposedAt > date) &&
					(a.isActive || (a.disposedAt && a.disposedAt > date)),
			)
			.flatMap((a) => {
				const v = valueAt(data.valuationsByAsset.get(a.id) ?? [], date);
				return v
					? [
							{
								id: a.id,
								name: a.name,
								category: a.category,
								currency: a.currency,
								valueMinor: v.valueMinor,
								acquisitionCostMinor: a.acquisitionCostMinor,
							},
						]
					: [];
			}),
		receivables: data.receivableRows
			.filter(
				(receivable) =>
					receivable.isActive ||
					(receivable.settledAt !== null && receivable.settledAt > date),
			)
			.flatMap((receivable) => {
				const balance = valueAt(
					data.balancesByReceivable.get(receivable.id) ?? [],
					date,
				);
				return balance
					? [
							{
								id: receivable.id,
								name: receivable.name,
								debtorName: receivable.debtorName,
								currency: receivable.currency,
								balanceMinor: balance.balanceMinor,
							},
						]
					: [];
			}),
		liabilities: data.liabilityRows
			// An inactive liability is over by today whatever its end date says:
			// a closed loan once kept its contractual term end, years ahead.
			.filter(
				(l) =>
					l.isActive || (l.endDate && l.endDate > date && date < todayIso()),
			)
			.flatMap((l) => {
				const v = valueAt(data.balancesByLiability.get(l.id) ?? [], date);
				return v
					? [
							{
								id: l.id,
								name: l.name,
								type: l.type,
								currency: l.currency,
								balanceMinor: v.balanceMinor,
								linkedAccountId: l.linkedAccountId,
							},
						]
					: [];
			}),
	};
}

/**
 * True when a connected broker depot makes every change figure meaningless.
 *
 * `snapshotAt` deliberately attaches a provider snapshot only to today: a
 * broker reading is an observation of now, not a price series that can be
 * back-cast. Every earlier snapshot therefore excludes the depot while today's
 * includes it, so subtracting the two yields the depot's entire value and
 * labels it as growth — "+120.000 € in 1 Tag", and the same number again for
 * the week, the month and the year. Any page showing a delta, a growth rate or
 * a history chart has to ask this first and say why the figure is missing.
 */
export function providerHistoryGap(snapshot: NetWorthBreakdown): boolean {
	return snapshot.providerBreakdown.length > 0;
}

export async function currentNetWorth(
	userId: string,
): Promise<NetWorthBreakdown> {
	const data = await loadHistories(userId);
	return snapshotAt(data, todayIso());
}

export type NetWorthHistoryPoint = {
	date: string;
	netWorthMinor: number;
	totalAssetsMinor: number;
	totalLiabilitiesMinor: number;
	liquidNetWorthMinor: number;
	cashMinor: number;
	investmentsMinor: number;
	physicalMinor: number;
	receivablesMinor: number;
};

/** Month-end snapshots for the last `months` months plus today. */
export async function netWorthHistory(
	userId: string,
	months = 24,
): Promise<NetWorthHistoryPoint[]> {
	const data = await loadHistories(userId);
	const today = todayIso();
	const start = addMonths(today, -months);
	const points: NetWorthHistoryPoint[] = [];
	for (const m of monthRange(start, today)) {
		const date = minIso(endOfMonth(`${m}-01`), today);
		const s = snapshotAt(data, date);
		points.push({
			date,
			netWorthMinor: s.netWorthMinor,
			totalAssetsMinor: s.totalAssetsMinor,
			totalLiabilitiesMinor: s.totalLiabilitiesMinor,
			liquidNetWorthMinor: s.liquidNetWorthMinor,
			cashMinor: s.cashMinor,
			investmentsMinor: s.investmentsMinor,
			physicalMinor: s.physicalMinor,
			receivablesMinor: s.receivablesMinor,
		});
	}
	return points;
}

export async function netWorthAt(
	userId: string,
	date: string,
): Promise<NetWorthBreakdown> {
	const data = await loadHistories(userId);
	return snapshotAt(data, date);
}

export type Holding = {
	key: string;
	label: string;
	amountMinor: number;
	group: string;
	kind:
		| "account"
		| "provider_cash"
		| "provider_position"
		| "asset"
		| "receivable";
};
export type HoldingsBreakdown = {
	date: string;
	baseCurrency: string;
	leaves: Holding[];
	groups: { key: string; label: string }[];
	netWorthMinor: number;
	totalLiabilitiesMinor: number;
};

/** Every holding valued in the base currency today, grouped by asset class. */
export async function holdingsBreakdown(
	userId: string,
): Promise<HoldingsBreakdown> {
	const data = await loadHistories(userId);
	const today = todayIso();
	const snapshot = snapshotAt(data, today);
	const conv = (amount: number, currency: string) => {
		const r = data.fx.convert(
			amount,
			currency,
			data.settings.baseCurrency,
			today,
		);
		return r.missing ? 0 : r.amountMinor;
	};
	const leaves: Holding[] = [];
	const selectedSourceIds = new Set(
		snapshot.providerBreakdown.map((a) => a.accountId),
	);
	const linkedSourceAccounts = new Set(
		data.providerAccountRows
			.filter((a) => selectedSourceIds.has(a.id) && a.linkedAccountId)
			.map((a) => a.linkedAccountId),
	);
	for (const a of data.accountRows) {
		if (linkedSourceAccounts.has(a.id)) continue;
		const v = conv(accountBalanceAt(data, a, today), a.currency);
		if (v <= 0) continue;
		const group = a.type === "investment" ? "investments" : "cash";
		leaves.push({
			key: `acc-${a.id}`,
			label: a.name,
			amountMinor: v,
			group,
			kind: "account",
		});
	}
	for (const source of snapshot.providerBreakdown) {
		if (source.cashMinor > 0)
			leaves.push({
				key: `source-cash-${source.accountId}`,
				label: "Scalable Capital · Guthaben",
				amountMinor: source.cashMinor,
				group: "cash",
				kind: "provider_cash",
			});
		for (const p of data.providerPositionRows.filter(
			(p) => p.accountId === source.accountId && p.valueMinor !== null,
		)) {
			const amountMinor = conv(p.valueMinor as number, p.currency);
			if (amountMinor > 0)
				leaves.push({
					key: `source-pos-${p.id}`,
					label: p.instrumentName,
					amountMinor,
					group: "investments",
					kind: "provider_position",
				});
		}
		// The provider's depot total can hold value no holding row carries,
		// such as Scalable's crypto subtotal. Net worth counts the total, so the
		// holdings show the rest as one leaf rather than inventing positions;
		// without it the Sankey fell short of the net worth beside it.
		if (source.unallocatedMinor > 0) {
			const row = data.providerAccountRows.find(
				(a) => a.id === source.accountId,
			);
			const crypto =
				row?.cryptoValueMinor !== null &&
				row?.cryptoValueMinor !== undefined &&
				conv(row.cryptoValueMinor, row.currency) === source.unallocatedMinor;
			leaves.push({
				key: `source-rest-${source.accountId}`,
				label: crypto
					? `${source.provider} · Krypto`
					: `${source.provider} · Ohne Einzelposition`,
				amountMinor: source.unallocatedMinor,
				group: "investments",
				kind: "provider_position",
			});
		}
	}
	let inventoryMinor = 0;
	for (const a of data.assetRows) {
		if (!a.isActive) continue;
		const v = valueAt(data.valuationsByAsset.get(a.id) ?? [], today);
		if (!v) continue;
		const amountMinor = conv(v.valueMinor, a.currency);
		if (a.category === "inventory") {
			inventoryMinor += amountMinor;
			continue;
		}
		leaves.push({
			key: `asset-${a.id}`,
			label: a.name,
			amountMinor,
			group: a.category,
			kind: "asset",
		});
	}
	if (inventoryMinor > 0) {
		leaves.push({
			key: "asset-inventory",
			label: "Remise Verkaufsbestand",
			amountMinor: inventoryMinor,
			group: "inventory",
			kind: "asset",
		});
	}
	for (const receivable of data.receivableRows) {
		if (!receivable.isActive) continue;
		const balance = valueAt(
			data.balancesByReceivable.get(receivable.id) ?? [],
			today,
		);
		if (!balance || balance.balanceMinor <= 0) continue;
		leaves.push({
			key: `receivable-${receivable.id}`,
			label: `${receivable.debtorName}: ${receivable.name}`,
			amountMinor: conv(balance.balanceMinor, receivable.currency),
			group: "receivables",
			kind: "receivable",
		});
	}
	const groups = [
		{ key: "cash", label: "Liquide Mittel" },
		{ key: "investments", label: "Wertpapiere" },
		{ key: "receivables", label: "Forderungen" },
		...Array.from(new Set(data.assetRows.map((a) => a.category))).map((c) => ({
			key: c,
			label: assetCategoryLabel(c),
		})),
	].filter((g) => leaves.some((l) => l.group === g.key));
	return {
		date: today,
		baseCurrency: data.settings.baseCurrency,
		leaves,
		groups,
		netWorthMinor: snapshot.netWorthMinor,
		totalLiabilitiesMinor: snapshot.totalLiabilitiesMinor,
	};
}

export type GrowthFacts = {
	baseCurrency: string;
	window: GrowthWindow;
	/** Net worth without the broker depot, on the history's own basis. */
	startNetWorthMinor: number;
	endNetWorthMinor: number;
	revaluationMinor: number;
	depot: {
		startMinor: number | null;
		endMinor: number | null;
		netDepositsMinor: number;
	} | null;
};

/**
 * Everything the growth breakdown needs from the balance sheet, on one
 * consistent basis. Past net worth never contains the depot (its snapshot is
 * an observation of now), so both ends are read without it and the depot is
 * reported separately: its value today, zero before its first broker
 * activity (the sync reads the full history), unknown otherwise.
 */
export async function growthFacts(
	userId: string,
	period: GrowthPeriod,
): Promise<GrowthFacts | null> {
	const data = await loadHistories(userId);
	const today = todayIso();
	const known = [
		...data.accountRows.map((account) => accountKnownFrom(data, account)),
		...[...data.valuationsByAsset.values()].map((rows) => rows[0]?.date),
	].filter((date): date is string => Boolean(date));
	const dataFrom = known.length
		? known.reduce((a, b) => (a < b ? a : b))
		: null;
	const window = growthWindow(period, today, dataFrom);
	if (!window) return null;

	const inputAt = (date: string) => snapshotInputAt(data, date);
	const withoutDepot = (input: NetWorthInput) =>
		computeNetWorth({ ...input, providerAccounts: [] });
	const startInput = inputAt(window.startDate);
	const endInput = inputAt(window.endDate);
	const endWithout = withoutDepot(endInput);

	const base = data.settings.baseCurrency;
	const conv = (amount: number, currency: string, date: string) => {
		const r = data.fx.convert(amount, currency, base, date);
		return r.missing ? 0 : r.amountMinor;
	};
	const startAssets = new Set(startInput.assets.map((a) => a.id));
	const endAssets = new Set(endInput.assets.map((a) => a.id));
	const revaluationMinor = assetRevaluationMinor(
		data.assetRows.map((asset) => ({
			valuations: (data.valuationsByAsset.get(asset.id) ?? []).map((row) => ({
				date: row.date,
				valueMinor: conv(row.valueMinor, asset.currency, row.date),
			})),
			countedAtStart: startAssets.has(asset.id),
			countedAtEnd: endAssets.has(asset.id),
			disposedAt: asset.disposedAt,
		})),
		window.startDate,
		window.endDate,
	);

	// The depot counted today; the same selection `currentNetWorth` uses.
	const depotIds = (inputAt(today).providerAccounts ?? []).map((a) => a.id);
	let depot: GrowthFacts["depot"] = null;
	if (depotIds.length) {
		const activity = (
			await db
				.select({
					occurredAt: investmentSourceTransactions.occurredAt,
					kind: investmentSourceTransactions.kind,
					status: investmentSourceTransactions.status,
					amountMinor: investmentSourceTransactions.amountMinor,
					currency: investmentSourceTransactions.currency,
				})
				.from(investmentSourceTransactions)
				.where(
					and(
						eq(investmentSourceTransactions.userId, userId),
						inArray(investmentSourceTransactions.accountId, depotIds),
					),
				)
		).map((row) => {
			const date = todayIso(row.occurredAt);
			return {
				date,
				kind: row.kind,
				status: row.status,
				amountMinor: conv(row.amountMinor, row.currency, date),
			};
		});
		const firstActivity = activity.length
			? activity.map((row) => row.date).reduce((a, b) => (a < b ? a : b))
			: null;
		const before = (date: string) =>
			firstActivity !== null && date < firstActivity;
		// Today's depot contribution, as net worth counts it (a linked manual
		// account steps aside for it).
		const depotToday =
			computeNetWorth(inputAt(today)).netWorthMinor -
			withoutDepot(inputAt(today)).netWorthMinor;
		depot = {
			startMinor: before(window.startDate) ? 0 : null,
			endMinor:
				window.endDate === today
					? depotToday
					: before(window.endDate)
						? 0
						: null,
			netDepositsMinor: netBrokerDepositsMinor(
				activity,
				window.cashflowFrom,
				window.endDate,
			),
		};
	}

	return {
		baseCurrency: base,
		window,
		startNetWorthMinor: withoutDepot(startInput).netWorthMinor,
		endNetWorthMinor: endWithout.netWorthMinor,
		revaluationMinor,
		depot,
	};
}
