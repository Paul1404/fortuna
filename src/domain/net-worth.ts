import { daysBetween } from "./dates";
import { FxTable } from "./fx";
import { parseDecimalToMinor } from "./money";

// Net worth is always: total assets minus total liabilities, computed from
// point-in-time values in the base currency.
//
// Definitions (deterministic, documented in the README):
//   cash          positive balances of current, savings and cash accounts
//   investments   investment account balances + priced positions
//   physical      manually valued assets (real estate, vehicles, ...)
//   receivables   money other people still owe the owner
//   liabilities   negative account balances (credit cards, overdrafts) +
//                 liability rows that are not mirrored by an account
//   liquid net worth = cash + investments - credit-card/overdraft balances
//   total net worth  = cash + investments + physical - liabilities

export type AccountSnapshot = {
	id: string;
	name: string;
	type:
		| "current"
		| "savings"
		| "credit_card"
		| "cash"
		| "investment"
		| "wallet";
	currency: string;
	balanceMinor: number;
	includeInNetWorth: boolean;
};

export type PositionSnapshot = {
	id: string;
	securityId: string;
	name: string;
	quantity: number;
	price: number | null;
	currency: string;
	costBasisMinor: number;
	accountId: string | null;
};

export type AssetSnapshot = {
	id: string;
	name: string;
	category: string;
	currency: string;
	valueMinor: number;
	acquisitionCostMinor: number | null;
};

export type LiabilitySnapshot = {
	id: string;
	name: string;
	type: string;
	currency: string;
	balanceMinor: number; // positive = amount owed
	linkedAccountId: string | null;
};

export type ReceivableSnapshot = {
	id: string;
	name: string;
	debtorName: string;
	currency: string;
	balanceMinor: number;
};

export type ProviderValuationConfidence =
	| "live"
	| "provider_reported"
	| "imported"
	| "estimated"
	| "stale"
	| "unavailable";

export type ProviderAccountSnapshot = {
	id: string;
	provider: string;
	/** "cli"; an older row may still carry a removed source's method. */
	method: string;
	linkedAccountId: string | null;
	currency: string;
	cashBalanceMinor: number | null;
	cashValuationAt: string | null;
	portfolioValueMinor: number | null;
	portfolioValuationAt: string | null;
	holdings: {
		id: string;
		name: string;
		isin: string;
		valueMinor: number | null;
		currency: string;
		valuationAt: string | null;
		confidence: ProviderValuationConfidence;
	}[];
};

export function effectiveValuationConfidence(
	confidence: ProviderValuationConfidence,
	valuationAt: string | null,
	asOf: string,
): ProviderValuationConfidence {
	if (confidence === "unavailable") return confidence;
	if (!valuationAt || daysBetween(valuationAt.slice(0, 10), asOf) > 30)
		return "stale";
	return confidence;
}

export type NetWorthInput = {
	date: string;
	baseCurrency: string;
	fx: FxTable;
	accounts: readonly AccountSnapshot[];
	positions: readonly PositionSnapshot[];
	providerAccounts?: readonly ProviderAccountSnapshot[];
	assets: readonly AssetSnapshot[];
	receivables?: readonly ReceivableSnapshot[];
	liabilities: readonly LiabilitySnapshot[];
};

export type AllocationSlice = {
	key: string;
	label: string;
	amountMinor: number;
	share: number;
};

export type NetWorthBreakdown = {
	date: string;
	baseCurrency: string;
	cashMinor: number;
	investmentsMinor: number;
	physicalMinor: number;
	receivablesMinor: number;
	totalAssetsMinor: number;
	creditCardDebtMinor: number;
	loanDebtMinor: number;
	totalLiabilitiesMinor: number;
	netWorthMinor: number;
	liquidNetWorthMinor: number;
	investedMinor: number;
	allocation: AllocationSlice[];
	liabilityBreakdown: AllocationSlice[];
	unconvertedCurrencies: string[];
	positionValues: {
		positionId: string;
		valueMinor: number;
		currency: string;
	}[];
	providerBreakdown: {
		accountId: string;
		provider: string;
		method: string;
		cashMinor: number;
		investmentsMinor: number;
		totalMinor: number;
		unvaluedHoldings: number;
		unallocatedMinor: number;
		valuationAt: string | null;
		confidence: ProviderValuationConfidence;
	}[];
};

export function positionValueMinor(p: PositionSnapshot): number | null {
	if (p.price === null) return null;
	// quantity * price * 100 rounds a half cent the wrong way, which is the
	// reason parseDecimalToMinor exists. Route the product through it.
	return parseDecimalToMinor(p.quantity * p.price);
}

export function computeNetWorth(input: NetWorthInput): NetWorthBreakdown {
	const unconverted = new Set<string>();
	const conv = (amountMinor: number, currency: string): number => {
		const r = input.fx.convert(
			amountMinor,
			currency,
			input.baseCurrency,
			input.date,
		);
		if (r.missing) {
			unconverted.add(currency.toUpperCase());
			return 0;
		}
		return r.amountMinor;
	};

	let cash = 0;
	let investments = 0;
	let creditCardDebt = 0;
	const providerAccounts = input.providerAccounts ?? [];
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
	const accountsWithPositions = new Set(
		input.positions.map((p) => p.accountId).filter(Boolean),
	);
	// Only an account whose balance is actually counted here can stand in for a
	// liability; otherwise the debt has to count on its own.
	const countedAccountIds = new Set<string>();
	for (const a of input.accounts) {
		if (!a.includeInNetWorth) continue;
		if (linkedProviderAccountIds.has(a.id)) continue;
		countedAccountIds.add(a.id);
		const v = conv(a.balanceMinor, a.currency);
		if (a.type === "credit_card") {
			if (v < 0) creditCardDebt += -v;
			else cash += v; // a credit balance on a card is money
			continue;
		}
		if (a.type === "investment") {
			// If positions are priced for this account, the account balance is the
			// cash/settlement part only and positions add their own value.
			if (v < 0) creditCardDebt += -v;
			else if (accountsWithPositions.has(a.id)) cash += v;
			else investments += v;
			continue;
		}
		if (v < 0)
			creditCardDebt += -v; // overdraft
		else cash += v;
	}

	const positionValues: NetWorthBreakdown["positionValues"] = [];
	for (const p of input.positions) {
		if (p.accountId && linkedProviderAccountIds.has(p.accountId)) continue;
		const value = positionValueMinor(p);
		if (value === null) continue;
		positionValues.push({
			positionId: p.id,
			valueMinor: value,
			currency: p.currency,
		});
		investments += conv(value, p.currency);
	}
	const providerBreakdown: NetWorthBreakdown["providerBreakdown"] = [];
	for (const account of providerAccounts) {
		const providerCash =
			account.cashBalanceMinor === null
				? 0
				: conv(account.cashBalanceMinor, account.currency);
		let providerInvestments = 0;
		let unvaluedHoldings = 0;
		let valuationAt = account.portfolioValuationAt ?? account.cashValuationAt;
		let confidence: ProviderValuationConfidence =
			account.method === "cli" ? "provider_reported" : "estimated";
		for (const holding of account.holdings) {
			if (holding.valueMinor === null) {
				unvaluedHoldings += 1;
				continue;
			}
			providerInvestments += conv(holding.valueMinor, holding.currency);
			if (
				!account.portfolioValuationAt &&
				holding.valuationAt &&
				(!valuationAt || holding.valuationAt < valuationAt)
			)
				valuationAt = holding.valuationAt;
			if (
				account.portfolioValueMinor === null &&
				(holding.confidence === "estimated" ||
					holding.confidence === "imported")
			)
				confidence = holding.confidence;
		}
		const holdingsTotal = providerInvestments;
		if (account.portfolioValueMinor !== null)
			providerInvestments = conv(account.portfolioValueMinor, account.currency);
		cash += providerCash;
		investments += providerInvestments;
		providerBreakdown.push({
			accountId: account.id,
			provider: account.provider,
			method: account.method,
			cashMinor: providerCash,
			investmentsMinor: providerInvestments,
			totalMinor: providerCash + providerInvestments,
			unvaluedHoldings,
			unallocatedMinor: providerInvestments - holdingsTotal,
			valuationAt,
			confidence: effectiveValuationConfidence(
				confidence,
				valuationAt,
				input.date,
			),
		});
	}

	let physical = 0;
	const allocation = new Map<string, AllocationSlice>();
	for (const asset of input.assets) {
		const v = conv(asset.valueMinor, asset.currency);
		physical += v;
		const slice = allocation.get(asset.category) ?? {
			key: asset.category,
			label: assetCategoryLabel(asset.category),
			amountMinor: 0,
			share: 0,
		};
		slice.amountMinor += v;
		allocation.set(asset.category, slice);
	}
	let receivablesTotal = 0;
	for (const receivable of input.receivables ?? []) {
		receivablesTotal += conv(receivable.balanceMinor, receivable.currency);
	}

	let loanDebt = 0;
	const liabilityBreakdown = new Map<string, AllocationSlice>();
	if (creditCardDebt > 0) {
		liabilityBreakdown.set("credit_card_accounts", {
			key: "credit_card_accounts",
			label: "Kreditkarten & Dispokredite",
			amountMinor: creditCardDebt,
			share: 0,
		});
	}
	for (const l of input.liabilities) {
		// Mirrored by an account that this snapshot counted: already included.
		if (l.linkedAccountId && countedAccountIds.has(l.linkedAccountId)) continue;
		const v = conv(l.balanceMinor, l.currency);
		loanDebt += v;
		const key = l.type;
		const slice = liabilityBreakdown.get(key) ?? {
			key,
			label: liabilityTypeLabel(l.type),
			amountMinor: 0,
			share: 0,
		};
		slice.amountMinor += v;
		liabilityBreakdown.set(key, slice);
	}

	const totalAssets = cash + investments + physical + receivablesTotal;
	const totalLiabilities = creditCardDebt + loanDebt;
	const alloc: AllocationSlice[] = [
		{ key: "cash", label: "Liquide Mittel", amountMinor: cash, share: 0 },
		{
			key: "investments",
			label: "Wertpapiere",
			amountMinor: investments,
			share: 0,
		},
		...Array.from(allocation.values()),
		{
			key: "receivables",
			label: "Forderungen",
			amountMinor: receivablesTotal,
			share: 0,
		},
	].filter((s) => s.amountMinor !== 0);
	for (const s of alloc)
		s.share = totalAssets > 0 ? s.amountMinor / totalAssets : 0;
	const liabs = Array.from(liabilityBreakdown.values());
	for (const s of liabs)
		s.share = totalLiabilities > 0 ? s.amountMinor / totalLiabilities : 0;

	return {
		date: input.date,
		baseCurrency: input.baseCurrency,
		cashMinor: cash,
		investmentsMinor: investments,
		physicalMinor: physical,
		receivablesMinor: receivablesTotal,
		totalAssetsMinor: totalAssets,
		creditCardDebtMinor: creditCardDebt,
		loanDebtMinor: loanDebt,
		totalLiabilitiesMinor: totalLiabilities,
		netWorthMinor: totalAssets - totalLiabilities,
		liquidNetWorthMinor: cash + investments - creditCardDebt,
		investedMinor: investments,
		allocation: alloc.sort((a, b) => b.amountMinor - a.amountMinor),
		liabilityBreakdown: liabs.sort((a, b) => b.amountMinor - a.amountMinor),
		unconvertedCurrencies: Array.from(unconverted),
		positionValues,
		providerBreakdown,
	};
}

/** Value of a dated series at `date`: the latest entry at or before it. */
export function valueAt<T extends { date: string }>(
	series: readonly T[],
	date: string,
): T | null {
	let found: T | null = null;
	for (const entry of series) {
		if (entry.date <= date) {
			if (!found || entry.date > found.date) found = entry;
		}
	}
	return found;
}

export function assetCategoryLabel(category: string): string {
	const labels: Record<string, string> = {
		real_estate: "Immobilien",
		vehicle: "Fahrzeuge",
		watch: "Uhren",
		collectible: "Sammlerstücke",
		precious_metal: "Edelmetalle",
		inventory: "Verkaufsbestand",
		private_investment: "Private Beteiligungen",
		other: "Sonstige Sachwerte",
	};
	// A category the map does not know is a code, not a name.
	return labels[category] ?? "—";
}

export function liabilityTypeLabel(type: string): string {
	const labels: Record<string, string> = {
		credit_card: "Kreditkarten",
		personal_loan: "Privatkredite",
		mortgage: "Immobiliendarlehen",
		vehicle_finance: "Fahrzeugfinanzierungen",
		other: "Sonstige Verbindlichkeiten",
	};
	return labels[type] ?? "—";
}

export { FxTable };
