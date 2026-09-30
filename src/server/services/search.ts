import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { ASSET_CATEGORY_LABELS, CATEGORY_KIND_LABELS } from "@/lib/labels";
import { db } from "@/server/db";
import {
	accounts,
	assets,
	categories,
	contracts,
	liabilities,
	merchants,
	optimizations,
	receivables,
	recurringPayments,
	transactions,
} from "@/server/db/schema";

export type SearchHit = {
	kind:
		| "transaction"
		| "account"
		| "asset"
		| "liability"
		| "receivable"
		| "optimization"
		| "merchant"
		| "category"
		| "recurring"
		| "contract";
	id: string;
	title: string;
	subtitle: string | null;
	amountMinor?: number;
	currency?: string;
	date?: string;
};

export async function globalSearch(
	userId: string,
	q: string,
	limit = 8,
): Promise<SearchHit[]> {
	const pattern = `%${q.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
	const [txs, recv, accs, ass, liab, merch, cats, rec, opts, contractRows] =
		await Promise.all([
			db
				.select({
					id: transactions.id,
					description: transactions.description,
					merchantName: transactions.merchantName,
					amountMinor: transactions.amountMinor,
					currency: transactions.currency,
					date: transactions.bookingDate,
					accountName: accounts.name,
				})
				.from(transactions)
				.innerJoin(accounts, eq(accounts.id, transactions.accountId))
				.where(
					and(
						eq(transactions.userId, userId),
						or(
							ilike(transactions.description, pattern),
							ilike(transactions.merchantName, pattern),
							ilike(transactions.counterpartyName, pattern),
							ilike(transactions.notes, pattern),
						),
					),
				)
				.orderBy(desc(transactions.bookingDate))
				.limit(limit),
			db
				.select({
					id: receivables.id,
					name: receivables.name,
					debtorName: receivables.debtorName,
					balance: receivables.currentBalanceMinor,
					currency: receivables.currency,
				})
				.from(receivables)
				.where(
					and(
						eq(receivables.userId, userId),
						or(
							ilike(receivables.name, pattern),
							ilike(receivables.debtorName, pattern),
							ilike(receivables.notes, pattern),
						),
					),
				)
				.limit(limit),
			db
				.select({
					id: accounts.id,
					name: accounts.name,
					institution: accounts.institution,
					balance: accounts.currentBalanceMinor,
					currency: accounts.currency,
				})
				.from(accounts)
				.where(
					and(
						eq(accounts.userId, userId),
						or(
							ilike(accounts.name, pattern),
							ilike(accounts.institution, pattern),
							ilike(accounts.iban, pattern),
						),
					),
				)
				.limit(limit),
			db
				.select({
					id: assets.id,
					name: assets.name,
					category: assets.category,
					value: assets.currentValueMinor,
					currency: assets.currency,
				})
				.from(assets)
				.where(
					and(
						eq(assets.userId, userId),
						or(
							ilike(assets.name, pattern),
							ilike(assets.reference, pattern),
							ilike(assets.notes, pattern),
						),
					),
				)
				.limit(limit),
			db
				.select({
					id: liabilities.id,
					name: liabilities.name,
					lender: liabilities.lender,
					balance: liabilities.currentBalanceMinor,
					currency: liabilities.currency,
				})
				.from(liabilities)
				.where(
					and(
						eq(liabilities.userId, userId),
						or(
							ilike(liabilities.name, pattern),
							ilike(liabilities.lender, pattern),
						),
					),
				)
				.limit(limit),
			db
				.select({
					id: merchants.id,
					name: merchants.name,
					count: sql<number>`(select count(*)::int from ${transactions} t where t.merchant_id = "merchants"."id")`,
				})
				.from(merchants)
				.where(
					and(eq(merchants.userId, userId), ilike(merchants.name, pattern)),
				)
				.limit(limit),
			db
				.select({
					id: categories.id,
					name: categories.name,
					kind: categories.kind,
				})
				.from(categories)
				.where(
					and(eq(categories.userId, userId), ilike(categories.name, pattern)),
				)
				.limit(limit),
			db
				.select({
					id: recurringPayments.id,
					name: recurringPayments.name,
					amount: recurringPayments.expectedAmountMinor,
					currency: recurringPayments.currency,
					next: recurringPayments.nextExpected,
				})
				.from(recurringPayments)
				.where(
					and(
						eq(recurringPayments.userId, userId),
						ilike(recurringPayments.name, pattern),
					),
				)
				.limit(limit),
			db
				.select({
					id: optimizations.id,
					title: optimizations.title,
					status: optimizations.status,
					monthly: sql<number>`${optimizations.currentMonthlyMinor} - ${optimizations.alternativeMonthlyMinor}`,
					currency: optimizations.currency,
				})
				.from(optimizations)
				.where(
					and(
						eq(optimizations.userId, userId),
						or(
							ilike(optimizations.title, pattern),
							ilike(optimizations.notes, pattern),
						),
					),
				)
				.limit(limit),
			db
				.select({
					id: contracts.id,
					name: contracts.name,
					provider: contracts.provider,
					number: contracts.contractNumber,
				})
				.from(contracts)
				.where(
					and(
						eq(contracts.userId, userId),
						or(
							ilike(contracts.name, pattern),
							ilike(contracts.provider, pattern),
							ilike(contracts.contractNumber, pattern),
						),
					),
				)
				.limit(limit),
		]);
	const hits: SearchHit[] = [];
	for (const a of accs)
		hits.push({
			kind: "account",
			id: a.id,
			title: a.name,
			subtitle: a.institution,
			amountMinor: a.balance,
			currency: a.currency,
		});
	for (const m of merch)
		hits.push({
			kind: "merchant",
			id: m.id,
			title: m.name,
			subtitle: `${m.count} Transaktionen`,
		});
	for (const c of cats)
		hits.push({
			kind: "category",
			id: c.id,
			title: c.name,
			subtitle: CATEGORY_KIND_LABELS[c.kind] ?? c.kind,
		});
	for (const r of rec)
		hits.push({
			kind: "recurring",
			id: r.id,
			title: r.name,
			subtitle: r.next ? `nächste Fälligkeit ${r.next}` : null,
			amountMinor: r.amount,
			currency: r.currency,
		});
	for (const a of ass)
		hits.push({
			kind: "asset",
			id: a.id,
			title: a.name,
			subtitle: ASSET_CATEGORY_LABELS[a.category] ?? a.category,
			amountMinor: a.value,
			currency: a.currency,
		});
	for (const l of liab)
		hits.push({
			kind: "liability",
			id: l.id,
			title: l.name,
			subtitle: l.lender,
			amountMinor: -l.balance,
			currency: l.currency,
		});
	for (const receivable of recv)
		hits.push({
			kind: "receivable",
			id: receivable.id,
			title: receivable.name,
			subtitle: receivable.debtorName,
			amountMinor: receivable.balance,
			currency: receivable.currency,
		});
	for (const t of txs)
		hits.push({
			kind: "transaction",
			id: t.id,
			title: t.merchantName ?? t.description,
			subtitle: `${t.accountName} · ${t.description}`,
			amountMinor: t.amountMinor,
			currency: t.currency,
			date: t.date,
		});
	for (const optimization of opts)
		hits.push({
			kind: "optimization",
			id: optimization.id,
			title: optimization.title,
			subtitle: optimization.status,
			amountMinor: optimization.monthly,
			currency: optimization.currency,
		});
	for (const contract of contractRows)
		hits.push({
			kind: "contract",
			id: contract.id,
			title: contract.name,
			subtitle:
				[contract.provider, contract.number].filter(Boolean).join(" · ") ||
				null,
		});
	// Cutting the flat list would drop whole kinds: eight matching accounts used
	// to fill the whole result and hide the transaction that was searched for.
	// One hit per kind per round keeps every kind visible, in the same order.
	const byKind = new Map<string, SearchHit[]>();
	for (const hit of hits)
		byKind.set(hit.kind, [...(byKind.get(hit.kind) ?? []), hit]);
	const mixed: SearchHit[] = [];
	for (let round = 0; mixed.length < limit; round++) {
		let added = false;
		for (const list of byKind.values()) {
			const hit = list[round];
			if (!hit) continue;
			mixed.push(hit);
			added = true;
			if (mixed.length === limit) break;
		}
		if (!added) break;
	}
	return mixed;
}
