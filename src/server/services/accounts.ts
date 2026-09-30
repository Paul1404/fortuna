import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { addMonths, todayIso } from "@/domain/dates";
import { type DbOrTx, db } from "@/server/db";
import {
	type Account,
	accountBalances,
	accounts,
	transactions,
} from "@/server/db/schema";

export type AccountListItem = Account & {
	transactionCount: number;
	lastTransactionDate: string | null;
};

export async function listAccounts(
	userId: string,
	options: { includeInactive?: boolean } = {},
): Promise<AccountListItem[]> {
	const rows = await db
		.select({
			account: accounts,
			transactionCount: sql<number>`(select count(*)::int from ${transactions} t where t.account_id = "accounts"."id")`,
			lastTransactionDate: sql<
				string | null
			>`(select max(t.booking_date)::text from ${transactions} t where t.account_id = "accounts"."id")`,
		})
		.from(accounts)
		.where(
			options.includeInactive
				? eq(accounts.userId, userId)
				: and(eq(accounts.userId, userId), eq(accounts.isActive, true)),
		)
		.orderBy(asc(accounts.sortOrder), asc(accounts.name));
	return rows.map((r) => ({
		...r.account,
		transactionCount: r.transactionCount,
		lastTransactionDate: r.lastTransactionDate,
	}));
}

export async function getAccount(
	userId: string,
	id: string,
	tx: DbOrTx = db,
): Promise<Account> {
	const row = await tx.query.accounts.findFirst({
		where: and(eq(accounts.id, id), eq(accounts.userId, userId)),
	});
	if (!row)
		throw new ORPCError("NOT_FOUND", { message: "Konto nicht gefunden" });
	return row;
}

export async function createAccount(
	userId: string,
	input: {
		name: string;
		institution?: string | null;
		type: Account["type"];
		currency: string;
		iban?: string | null;
		openingBalanceMinor?: number;
		openingBalanceDate?: string;
		creditLimitMinor?: number | null;
		includeInNetWorth?: boolean;
		notes?: string | null;
	},
): Promise<Account> {
	return db.transaction(async (tx) => {
		const date = input.openingBalanceDate ?? todayIso();
		const [row] = await tx
			.insert(accounts)
			.values({
				userId,
				name: input.name,
				institution: input.institution ?? null,
				type: input.type,
				currency: input.currency,
				iban: input.iban ? input.iban.replace(/\s/g, "").toUpperCase() : null,
				currentBalanceMinor: input.openingBalanceMinor ?? 0,
				balanceAsOf: date,
				creditLimitMinor: input.creditLimitMinor ?? null,
				includeInNetWorth: input.includeInNetWorth ?? true,
				notes: input.notes ?? null,
			})
			.returning();
		await tx.insert(accountBalances).values({
			accountId: row.id,
			date,
			balanceMinor: input.openingBalanceMinor ?? 0,
			source: "opening",
		});
		return row;
	});
}

export async function updateAccount(
	userId: string,
	input: { id: string } & Partial<
		Omit<Account, "id" | "userId" | "createdAt" | "updatedAt">
	>,
): Promise<Account> {
	const { id, ...patch } = input;
	if (patch.iban) patch.iban = patch.iban.replace(/\s/g, "").toUpperCase();
	const [row] = await db
		.update(accounts)
		.set(patch)
		.where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
		.returning();
	if (!row)
		throw new ORPCError("NOT_FOUND", { message: "Konto nicht gefunden" });
	return row;
}

/** Record a balance observation and make it the current balance when newest. */
export async function recordBalance(
	userId: string,
	input: {
		accountId: string;
		date: string;
		balanceMinor: number;
		source?: string;
	},
	tx: DbOrTx = db,
): Promise<void> {
	// The observation and the balance it implies must land together.
	if (tx === db) return db.transaction((t) => recordBalance(userId, input, t));
	const account = await getAccount(userId, input.accountId, tx);
	await tx
		.insert(accountBalances)
		.values({
			accountId: account.id,
			date: input.date,
			balanceMinor: input.balanceMinor,
			source: input.source ?? "manual",
		})
		.onConflictDoUpdate({
			target: [accountBalances.accountId, accountBalances.date],
			set: {
				balanceMinor: input.balanceMinor,
				source: input.source ?? "manual",
			},
		});
	await recomputeAccountBalance(userId, account.id, tx);
}

/** Rebuild the denormalised current balance from its latest observation. */
export async function recomputeAccountBalance(
	userId: string,
	accountId: string,
	tx: DbOrTx = db,
): Promise<void> {
	await getAccount(userId, accountId, tx);
	const [observation] = await tx
		.select({
			date: accountBalances.date,
			balanceMinor: accountBalances.balanceMinor,
		})
		.from(accountBalances)
		.where(eq(accountBalances.accountId, accountId))
		.orderBy(desc(accountBalances.date))
		.limit(1);
	// No observation yet: a provider sync inserts the account with the balance
	// it reported and records the observation after the first transactions land.
	// The balance on the row is the only anchor until then, so leave it alone.
	if (!observation) return;
	const [after] = await tx
		.select({
			deltaMinor: sql<number>`coalesce(sum(${transactions.amountMinor}), 0)::bigint`,
			latestDate: sql<string | null>`max(${transactions.bookingDate})::text`,
		})
		.from(transactions)
		.where(
			and(
				eq(transactions.accountId, accountId),
				eq(transactions.status, "booked"),
				gte(transactions.bookingDate, sql`${observation.date}::date + 1`),
			),
		);
	await tx
		.update(accounts)
		.set({
			currentBalanceMinor:
				observation.balanceMinor + Number(after?.deltaMinor ?? 0),
			balanceAsOf: after?.latestDate ?? observation.date,
		})
		.where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
}

/**
 * Derive the balance history from the latest observation and transactions.
 * Observed balances win; between them the running sum of transactions fills
 * in day-level detail. Returns one point per day that changed.
 */
export async function balanceHistory(
	userId: string,
	accountId: string,
	months = 12,
): Promise<{ date: string; balanceMinor: number; observed: boolean }[]> {
	const account = await getAccount(userId, accountId);
	const from = addMonths(todayIso(), -months);
	const observed = await db
		.select()
		.from(accountBalances)
		.where(eq(accountBalances.accountId, accountId))
		.orderBy(asc(accountBalances.date));
	const txRows = await db
		.select({
			date: transactions.bookingDate,
			amount: sql<number>`sum(${transactions.amountMinor})::bigint`,
		})
		.from(transactions)
		.where(
			and(
				eq(transactions.accountId, accountId),
				eq(transactions.status, "booked"),
			),
		)
		.groupBy(transactions.bookingDate)
		.orderBy(asc(transactions.bookingDate));
	const dailyNet = new Map(txRows.map((r) => [r.date, Number(r.amount)]));

	// Walk backwards from the current balance so the series always ends on the
	// number the account row shows.
	const dates = Array.from(
		new Set([...observed.map((o) => o.date), ...dailyNet.keys()]),
	).sort();
	const observedByDate = new Map(observed.map((o) => [o.date, o.balanceMinor]));
	const points: { date: string; balanceMinor: number; observed: boolean }[] =
		[];
	let running = account.currentBalanceMinor;
	const asOf = account.balanceAsOf ?? todayIso();
	for (let i = dates.length - 1; i >= 0; i--) {
		const d = dates[i];
		if (d > asOf) continue;
		const obs = observedByDate.get(d);
		if (obs !== undefined) running = obs;
		points.push({
			date: d,
			balanceMinor: running,
			observed: obs !== undefined,
		});
		running -= dailyNet.get(d) ?? 0;
	}
	points.reverse();
	const filtered = points.filter((p) => p.date >= from);
	if (filtered.length === 0 || filtered[filtered.length - 1].date < asOf) {
		filtered.push({
			date: asOf,
			balanceMinor: account.currentBalanceMinor,
			observed: true,
		});
	}
	return filtered;
}

export async function ownIbans(
	userId: string,
	tx: DbOrTx = db,
): Promise<Set<string>> {
	const rows = await tx
		.select({ iban: accounts.iban })
		.from(accounts)
		.where(eq(accounts.userId, userId));
	return new Set(
		rows.map((r) => r.iban).filter((i): i is string => Boolean(i)),
	);
}

export { gte };
