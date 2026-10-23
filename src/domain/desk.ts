import { MIN_ORDER_MINOR, MIN_TRANSFER_MINOR } from "./capital-advice";
import { type ContractLifecycleInput, contractPhase } from "./contract";
import type {
	DeskTask,
	LiquidityItem,
	LiquidityStructure,
	LiquidityTier,
} from "./desk-contract";
import { isActionableProblem } from "./hr-koerner-notifications";
import { formatMoney } from "./money";
import { computeNetWorth, type NetWorthInput } from "./net-worth";

/**
 * Hr. Körner's desk: the few things worth doing today, each doable in one
 * step, and how quickly the owner's wealth becomes spendable money.
 *
 * Everything here is pure. The service gathers the inputs from the existing
 * engines (categorisation, observations, data quality, net worth) and this module only decides what to put on the
 * desk, in which order, and in which words. Money is always a proposal the
 * owner acts on; Fortuna never moves it.
 */

// ---------------------------------------------------------------------------
// Liquidity structure
// ---------------------------------------------------------------------------

const TIER_ORDER: LiquidityTier[] = ["now", "days", "locked", "sellable"];

export type LiquidityContract = ContractLifecycleInput & {
	id: string;
	name: string;
	accountId: string | null;
};

export type LiquidityInput = {
	/** Exactly the input `currentNetWorth` is computed from. */
	netWorth: NetWorthInput;
	/** Contracts, for the date a locked account can be had. */
	contracts: readonly LiquidityContract[];
	/** `assets.sync_source` per asset id; "remise" marks Remise inventory. */
	assetSyncSources: ReadonlyMap<string, string | null>;
	/** `receivables.due_date` per receivable id. */
	receivableDueDates: ReadonlyMap<string, string | null>;
};

function germanDate(iso: string): string {
	const [year, month, day] = iso.slice(0, 10).split("-");
	return `${day}.${month}.${year}`;
}

/**
 * The asset side of net worth, sorted by how quickly each part becomes
 * spendable money:
 *
 * - `now`: current, savings, cash and wallet accounts, and a credit card
 *   in credit. Credit-card debt is not netted here: it is a liability, and
 *   netting it would make the tiers stop adding up to total assets. The card
 *   bill is still a claim on this money, which is why the desk says so.
 * - `days`: broker cash and listed securities, sellable within about T+2.
 * - `locked`: investment accounts that are not a broker depot (a private
 *   equity fund, an insurance surrender value) and receivables. A locked
 *   account is available from its linked contract's end date; a receivable
 *   from its due date. Receivables sit here because the owner cannot turn
 *   them into money on their own; they wait for the debtor.
 *   Private investments held as assets are locked for the same reason.
 * - `sellable`: physical assets, each Remise item on its own.
 *
 * Every amount is converted exactly as `computeNetWorth` converts it, and the
 * totals add up to its `totalAssetsMinor`.
 */
export function liquidityStructure(input: LiquidityInput): LiquidityStructure {
	const nw = input.netWorth;
	const breakdown = computeNetWorth(nw);
	const conv = (amountMinor: number, currency: string): number => {
		const result = nw.fx.convert(
			amountMinor,
			currency,
			nw.baseCurrency,
			nw.date,
		);
		return result.missing ? 0 : result.amountMinor;
	};
	const items: LiquidityItem[] = [];
	const push = (item: LiquidityItem) => {
		if (item.valueMinor !== 0) items.push(item);
	};

	// The same exclusions `computeNetWorth` applies: an account mirrored by a
	// valued broker snapshot is counted by the snapshot, not twice.
	const providerAccounts = nw.providerAccounts ?? [];
	const linkedProviderAccountIds = new Set(
		providerAccounts
			.filter(
				(a) =>
					a.cashBalanceMinor !== null ||
					a.portfolioValueMinor !== null ||
					a.holdings.some((h) => h.valueMinor !== null),
			)
			.map((a) => a.linkedAccountId)
			.filter((id): id is string => Boolean(id)),
	);
	const contractByAccount = new Map<string, LiquidityContract>();
	for (const contract of input.contracts) {
		if (!contract.accountId) continue;
		const existing = contractByAccount.get(contract.accountId);
		// With several, the one that ends last decides when the money is free.
		if (
			!existing ||
			(contract.endDate &&
				(!existing.endDate || contract.endDate > existing.endDate))
		)
			contractByAccount.set(contract.accountId, contract);
	}

	for (const account of nw.accounts) {
		if (!account.includeInNetWorth) continue;
		if (linkedProviderAccountIds.has(account.id)) continue;
		const value = conv(account.balanceMinor, account.currency);
		// A negative balance is a liability, not part of the asset side.
		if (value <= 0) continue;
		const href = `/accounts/${account.id}`;
		if (account.type === "investment") {
			const contract = contractByAccount.get(account.id);
			const phase = contract ? contractPhase(contract, nw.date) : null;
			push({
				id: `account:${account.id}`,
				name: account.name,
				tier: "locked",
				valueMinor: value,
				availableFrom: contract?.endDate ?? null,
				note: !contract
					? "Kein Vertrag mit Laufzeitende verknüpft"
					: !contract.endDate
						? `${contract.name} hat kein Laufzeitende`
						: phase === "ended"
							? `${contract.name} ist seit ${germanDate(contract.endDate)} beendet`
							: `Gebunden bis ${germanDate(contract.endDate)} (${contract.name})`,
				href,
			});
			continue;
		}
		push({
			id: `account:${account.id}`,
			name: account.name,
			tier: "now",
			valueMinor: value,
			availableFrom: null,
			note: account.type === "credit_card" ? "Guthaben auf der Karte" : null,
			href,
		});
	}

	for (const depot of breakdown.providerBreakdown) {
		const href = `/depots/${depot.accountId}`;
		push({
			id: `depot-cash:${depot.accountId}`,
			name: `${depot.provider} · Guthaben`,
			tier: "days",
			valueMinor: depot.cashMinor,
			availableFrom: null,
			note: "Guthaben beim Broker, per Auszahlung in wenigen Tagen da",
			href,
		});
		push({
			id: `depot:${depot.accountId}`,
			name: `${depot.provider} · Wertpapiere`,
			tier: "days",
			valueMinor: depot.investmentsMinor,
			availableFrom: null,
			note: "Börsengehandelt, in wenigen Tagen verkauft",
			href,
		});
	}

	for (const asset of nw.assets) {
		const value = conv(asset.valueMinor, asset.currency);
		const remise = input.assetSyncSources.get(asset.id) === "remise";
		const href = `/assets/${asset.id}`;
		if (asset.category === "private_investment" && !remise) {
			push({
				id: `asset:${asset.id}`,
				name: asset.name,
				tier: "locked",
				valueMinor: value,
				availableFrom: null,
				note: "Private Beteiligung, nicht frei handelbar",
				href,
			});
			continue;
		}
		push({
			id: `asset:${asset.id}`,
			name: asset.name,
			tier: "sellable",
			valueMinor: value,
			availableFrom: null,
			note: remise
				? "Im Remise-Bestand"
				: asset.category === "real_estate"
					? "Ein Verkauf dauert Monate"
					: null,
			href,
		});
	}

	for (const receivable of nw.receivables ?? []) {
		const dueDate = input.receivableDueDates.get(receivable.id) ?? null;
		push({
			id: `receivable:${receivable.id}`,
			name: `${receivable.debtorName}: ${receivable.name}`,
			tier: "locked",
			valueMinor: conv(receivable.balanceMinor, receivable.currency),
			availableFrom: dueDate,
			note: dueDate
				? `Forderung, fällig am ${germanDate(dueDate)}`
				: "Forderung ohne Fälligkeit",
			href: `/debts?highlight=${receivable.id}`,
		});
	}

	items.sort(
		(left, right) =>
			TIER_ORDER.indexOf(left.tier) - TIER_ORDER.indexOf(right.tier) ||
			right.valueMinor - left.valueMinor ||
			left.id.localeCompare(right.id),
	);
	const totals: Record<LiquidityTier, number> = {
		now: 0,
		days: 0,
		locked: 0,
		sellable: 0,
	};
	for (const item of items) totals[item.tier] += item.valueMinor;
	return { baseCurrency: nw.baseCurrency, totals, items };
}

/**
 * Where a transfer to the depot would come from: the current or savings
 * account in base currency holding the most money.
 */
export function transferSource(
	accounts: readonly {
		id: string;
		name: string;
		type: string;
		currency: string;
		balanceMinor: number;
		includeInNetWorth: boolean;
	}[],
	baseCurrency: string,
): { id: string; name: string; balanceMinor: number } | null {
	let best: { id: string; name: string; balanceMinor: number } | null = null;
	for (const account of accounts) {
		if (!account.includeInNetWorth) continue;
		if (account.type !== "current" && account.type !== "savings") continue;
		if (account.currency !== baseCurrency || account.balanceMinor <= 0)
			continue;
		if (!best || account.balanceMinor > best.balanceMinor)
			best = {
				id: account.id,
				name: account.name,
				balanceMinor: account.balanceMinor,
			};
	}
	return best;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type DeskObservation = {
	type: string;
	actionable: boolean;
	id: string;
	key: string;
	severity: "info" | "notable" | "review" | "urgent";
	title: string;
	explanation: string;
	impactMinor: number | null;
	currency: string | null;
};

export type DeskQualityEntry = {
	id: string;
	kind: "account" | "asset" | "liability" | "receivable" | "fxRate";
	name: string;
	state: string;
	ageDays: number | null;
};

export type DeskInputs = {
	today: string;
	baseCurrency: string;
	/** Uncategorised bookings the owner still has to decide after auto-filing. */
	bookings: {
		open: number;
		/** Of those, how many carry a proposal the owner has to confirm. */
		withProposal: number;
		/** Sum of their magnitudes in base currency (other currencies left out). */
		amountMinor: number;
	};
	/** Hr. Körner's open observations. */
	observations: readonly DeskObservation[];
	/** Only a missing exchange rate has a concrete effect on totals. */
	quality: readonly DeskQualityEntry[];
};

const SEVERITY_RANK: Record<DeskTask["severity"], number> = {
	urgent: 0,
	review: 1,
	info: 2,
};

/**
 * Urgent before review before info, then the larger sum. Ties keep the order
 * they were composed in (the sort is stable), so equally important tasks keep their order.
 */
export function orderTasks(tasks: readonly DeskTask[]): DeskTask[] {
	return [...tasks].sort(
		(left, right) =>
			SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
			(right.amountMinor ?? -1) - (left.amountMinor ?? -1),
	);
}

/** An investment opportunity stays outside the task list. */
export function investmentOpportunity(
	free: { bankMinor: number; brokerMinor: number } | null,
): { bankMinor: number; brokerMinor: number } | null {
	if (
		!free ||
		(free.bankMinor < MIN_TRANSFER_MINOR && free.brokerMinor < MIN_ORDER_MINOR)
	)
		return null;
	return {
		bankMinor: free.bankMinor >= MIN_TRANSFER_MINOR ? free.bankMinor : 0,
		brokerMinor: free.brokerMinor,
	};
}

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

function observationSeverity(
	severity: DeskObservation["severity"],
): DeskTask["severity"] {
	if (severity === "urgent") return "urgent";
	if (severity === "review") return "review";
	return "info";
}

export function composeDeskTasks(input: DeskInputs): DeskTask[] {
	const money = (minor: number) => formatMoney(minor, input.baseCurrency);
	const tasks: DeskTask[] = [];

	if (input.bookings.open > 0) {
		const { open, withProposal } = input.bookings;
		const unknown = open - withProposal;
		const parts = [
			withProposal > 0 ? `${withProposal} mit Vorschlag` : null,
			unknown > 0 ? `${unknown} ohne Anhaltspunkt` : null,
		].filter(Boolean);
		tasks.push({
			key: "review_bookings",
			severity: "review",
			title: `${plural(open, "Buchung", "Buchungen")} ohne Kategorie`,
			detail: `${parts.join(", ")}${input.bookings.amountMinor > 0 ? `, zusammen ${money(input.bookings.amountMinor)}` : ""}.`,
			amountMinor:
				input.bookings.amountMinor > 0 ? input.bookings.amountMinor : null,
			action: { kind: "review_bookings" },
		});
	}

	// Trends, estimates and optional analysis are observations, never chores.
	for (const observation of input.observations.filter(isActionableProblem))
		tasks.push({
			key: `observation:${observation.key}`,
			severity: observationSeverity(observation.severity),
			title: observation.title,
			detail: observation.explanation,
			amountMinor:
				observation.impactMinor !== null &&
				observation.currency === input.baseCurrency
					? Math.abs(observation.impactMinor)
					: null,
			action: {
				kind: "observation",
				observationId: observation.id,
			},
		});

	for (const entry of input.quality.filter(
		(entry) => entry.kind === "fxRate" && entry.state === "missing",
	))
		tasks.push({
			key: `missing_rate:${entry.id}`,
			severity: "review",
			title: `${entry.name} fehlt`,
			detail: "Beträge in dieser Währung fehlen in den Summen.",
			amountMinor: null,
			action: { kind: "open", href: "/settings" },
		});

	return orderTasks(tasks);
}

// ---------------------------------------------------------------------------
// Auto-filing summary
// ---------------------------------------------------------------------------

/**
 * "Rewe → Lebensmittel (4)" per merchant and category, largest first, at most
 * five lines; beyond that the fifth line counts the rest.
 */
export function filedSummary(
	rows: readonly { merchant: string; categoryName: string }[],
): string[] {
	const groups = new Map<
		string,
		{ merchant: string; category: string; count: number }
	>();
	for (const row of rows) {
		const key = `${row.merchant.toLowerCase()}|${row.categoryName}`;
		const entry = groups.get(key) ?? {
			merchant: row.merchant,
			category: row.categoryName,
			count: 0,
		};
		entry.count += 1;
		groups.set(key, entry);
	}
	const sorted = [...groups.values()].sort(
		(left, right) =>
			right.count - left.count || left.merchant.localeCompare(right.merchant),
	);
	const line = (entry: (typeof sorted)[number]) =>
		`${entry.merchant} → ${entry.category} (${entry.count})`;
	if (sorted.length <= 5) return sorted.map(line);
	const rest = sorted.slice(4).reduce((sum, entry) => sum + entry.count, 0);
	return [
		...sorted.slice(0, 4).map(line),
		`${plural(rest, "weitere Buchung", "weitere Buchungen")}`,
	];
}
