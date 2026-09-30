import { monthKey, monthRange } from "./dates";

// Cashflow aggregation. Internal transfers (both legs share a transfer group)
// and transactions in categories of kind "transfer" never count as income or
// expense. Amounts are assumed to already be in the base currency.

export type CashflowTx = {
	bookingDate: string;
	amountMinor: number;
	categoryId: string | null;
	transferGroupId?: string | null;
	status?: "pending" | "booked";
};

export type CategoryInfo = {
	id: string;
	kind: "income" | "expense" | "transfer" | "other";
	parentId: string | null;
	name: string;
};

export type MonthlyCashflow = {
	month: string;
	incomeMinor: number;
	expenseMinor: number; // positive number
	netMinor: number;
	transactionCount: number;
};

export function isCashflowRelevant(
	tx: CashflowTx,
	categories: ReadonlyMap<string, CategoryInfo>,
): boolean {
	if (tx.transferGroupId) return false;
	if (tx.status === "pending") return false;
	if (tx.categoryId) {
		const cat = categories.get(tx.categoryId);
		if (cat?.kind === "transfer") return false;
	}
	return true;
}

export function monthlyCashflow(
	txs: readonly CashflowTx[],
	categories: ReadonlyMap<string, CategoryInfo>,
	from: string,
	to: string,
): MonthlyCashflow[] {
	const months = new Map<string, MonthlyCashflow>();
	for (const m of monthRange(from, to)) {
		months.set(m, {
			month: m,
			incomeMinor: 0,
			expenseMinor: 0,
			netMinor: 0,
			transactionCount: 0,
		});
	}
	for (const tx of txs) {
		if (tx.bookingDate < from || tx.bookingDate > to) continue;
		if (!isCashflowRelevant(tx, categories)) continue;
		const bucket = months.get(monthKey(tx.bookingDate));
		if (!bucket) continue;
		if (tx.amountMinor >= 0) bucket.incomeMinor += tx.amountMinor;
		else bucket.expenseMinor += -tx.amountMinor;
		bucket.netMinor = bucket.incomeMinor - bucket.expenseMinor;
		bucket.transactionCount += 1;
	}
	return Array.from(months.values());
}

export type CategoryTotal = {
	categoryId: string | null;
	name: string;
	amountMinor: number; // positive spend
	transactionCount: number;
	share: number; // 0..1 of total
};

/** Spending by top-level category (children roll up into their parent). */
export function spendingByCategory(
	txs: readonly CashflowTx[],
	categories: ReadonlyMap<string, CategoryInfo>,
	from: string,
	to: string,
	options: { rollUp?: boolean } = {},
): CategoryTotal[] {
	const rollUp = options.rollUp ?? true;
	const totals = new Map<string | null, CategoryTotal>();
	let grand = 0;
	for (const tx of txs) {
		if (tx.bookingDate < from || tx.bookingDate > to) continue;
		if (tx.amountMinor >= 0) continue;
		if (!isCashflowRelevant(tx, categories)) continue;
		let catId = tx.categoryId;
		if (rollUp && catId) {
			const cat = categories.get(catId);
			if (cat?.parentId) catId = cat.parentId;
		}
		const name = catId
			? (categories.get(catId)?.name ?? "Unbekannt")
			: "Nicht kategorisiert";
		const entry = totals.get(catId) ?? {
			categoryId: catId,
			name,
			amountMinor: 0,
			transactionCount: 0,
			share: 0,
		};
		entry.amountMinor += -tx.amountMinor;
		entry.transactionCount += 1;
		grand += -tx.amountMinor;
		totals.set(catId, entry);
	}
	const list = Array.from(totals.values()).sort(
		(a, b) => b.amountMinor - a.amountMinor,
	);
	for (const e of list) e.share = grand > 0 ? e.amountMinor / grand : 0;
	return list;
}

export function rollingAverage(
	series: readonly MonthlyCashflow[],
	window: number,
): MonthlyCashflow[] {
	return series.map((point, i) => {
		const slice = series.slice(Math.max(0, i - window + 1), i + 1);
		const n = slice.length;
		const incomeMinor = Math.round(
			slice.reduce((s, p) => s + p.incomeMinor, 0) / n,
		);
		const expenseMinor = Math.round(
			slice.reduce((s, p) => s + p.expenseMinor, 0) / n,
		);
		return {
			month: point.month,
			incomeMinor,
			expenseMinor,
			netMinor: incomeMinor - expenseMinor,
			transactionCount: point.transactionCount,
		};
	});
}

export function savingsRate(
	incomeMinor: number,
	expenseMinor: number,
): number | null {
	if (incomeMinor <= 0) return null;
	return (incomeMinor - expenseMinor) / incomeMinor;
}

export function periodTotals(series: readonly MonthlyCashflow[]): {
	incomeMinor: number;
	expenseMinor: number;
	netMinor: number;
} {
	const incomeMinor = series.reduce((s, p) => s + p.incomeMinor, 0);
	const expenseMinor = series.reduce((s, p) => s + p.expenseMinor, 0);
	return { incomeMinor, expenseMinor, netMinor: incomeMinor - expenseMinor };
}
