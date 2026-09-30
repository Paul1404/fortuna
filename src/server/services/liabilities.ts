import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { todayIso } from "@/domain/dates";
import { type DbOrTx, db } from "@/server/db";
import {
	accounts,
	assets,
	type Liability,
	liabilities,
	liabilityBalances,
} from "@/server/db/schema";

export type LiabilityRow = Liability & {
	linkedAssetName: string | null;
	linkedAccountName: string | null;
	linkedAccountBalanceMinor: number | null;
	balanceCount: number;
	/**
	 * What is owed now, in the liability's currency. A liability linked to an
	 * account (a credit card) takes its debt from that account: its own
	 * `currentBalanceMinor` is whatever was typed in when it was created and is
	 * never updated again, because nothing records a balance on it.
	 */
	owedMinor: number;
	/** The date `owedMinor` is as of: the linked account's, or its own. */
	owedAsOf: string | null;
};

export async function listLiabilities(
	userId: string,
	options: { includeInactive?: boolean } = {},
): Promise<LiabilityRow[]> {
	const rows = await db
		.select({
			l: liabilities,
			linkedAssetName: assets.name,
			linkedAccountName: accounts.name,
			linkedAccountBalanceMinor: accounts.currentBalanceMinor,
			linkedAccountCurrency: accounts.currency,
			linkedAccountBalanceAsOf: accounts.balanceAsOf,
		})
		.from(liabilities)
		.leftJoin(assets, eq(assets.id, liabilities.linkedAssetId))
		.leftJoin(accounts, eq(accounts.id, liabilities.linkedAccountId))
		.where(
			options.includeInactive
				? eq(liabilities.userId, userId)
				: and(eq(liabilities.userId, userId), eq(liabilities.isActive, true)),
		)
		.orderBy(desc(liabilities.currentBalanceMinor));
	const counts = await db
		.select({ liabilityId: liabilityBalances.liabilityId })
		.from(liabilityBalances)
		.innerJoin(liabilities, eq(liabilities.id, liabilityBalances.liabilityId))
		.where(eq(liabilities.userId, userId));
	const countMap = new Map<string, number>();
	for (const c of counts)
		countMap.set(c.liabilityId, (countMap.get(c.liabilityId) ?? 0) + 1);
	return rows.map((r) => {
		// An account in another currency cannot stand in for the amount without
		// a conversion; the liability's own figure is then the better one.
		const fromAccount =
			r.l.linkedAccountId !== null &&
			r.linkedAccountBalanceMinor !== null &&
			r.linkedAccountCurrency === r.l.currency;
		return {
			...r.l,
			linkedAssetName: r.linkedAssetName,
			linkedAccountName: r.linkedAccountName,
			linkedAccountBalanceMinor: r.linkedAccountBalanceMinor,
			balanceCount: countMap.get(r.l.id) ?? 0,
			owedMinor: fromAccount
				? Math.max(0, -(r.linkedAccountBalanceMinor as number))
				: r.l.currentBalanceMinor,
			owedAsOf: fromAccount ? r.linkedAccountBalanceAsOf : r.l.balanceAsOf,
		};
	});
}

export async function getLiability(
	userId: string,
	id: string,
	tx: DbOrTx = db,
) {
	const row = await tx.query.liabilities.findFirst({
		where: and(eq(liabilities.id, id), eq(liabilities.userId, userId)),
		with: { balances: { orderBy: [asc(liabilityBalances.date)] } },
	});
	if (!row)
		throw new ORPCError("NOT_FOUND", {
			message: "Verbindlichkeit nicht gefunden",
		});
	return row;
}

/** A liability may only point at the owner's own asset or account. */
async function assertLinkedReferences(
	userId: string,
	input: { linkedAssetId?: string | null; linkedAccountId?: string | null },
) {
	if (input.linkedAssetId) {
		const row = await db.query.assets.findFirst({
			where: and(eq(assets.id, input.linkedAssetId), eq(assets.userId, userId)),
		});
		if (!row)
			throw new ORPCError("BAD_REQUEST", {
				message: "Sachwert nicht gefunden",
			});
	}
	if (input.linkedAccountId) {
		const row = await db.query.accounts.findFirst({
			where: and(
				eq(accounts.id, input.linkedAccountId),
				eq(accounts.userId, userId),
			),
		});
		if (!row)
			throw new ORPCError("BAD_REQUEST", { message: "Konto nicht gefunden" });
	}
}

export async function createLiability(
	userId: string,
	input: Omit<
		typeof liabilities.$inferInsert,
		"id" | "userId" | "createdAt" | "updatedAt" | "balanceAsOf"
	> & { balanceDate?: string },
): Promise<Liability> {
	await assertLinkedReferences(userId, input);
	return db.transaction(async (tx) => {
		const { balanceDate, ...rest } = input;
		const date = balanceDate ?? todayIso();
		const [row] = await tx
			.insert(liabilities)
			.values({ ...rest, userId, balanceAsOf: date })
			.returning();
		if (
			rest.startDate &&
			rest.originalAmountMinor !== null &&
			rest.originalAmountMinor !== undefined &&
			rest.startDate < date
		) {
			await tx.insert(liabilityBalances).values({
				liabilityId: row.id,
				date: rest.startDate,
				balanceMinor: rest.originalAmountMinor,
			});
		}
		await tx.insert(liabilityBalances).values({
			liabilityId: row.id,
			date,
			balanceMinor: rest.currentBalanceMinor ?? 0,
		});
		return row;
	});
}

export async function updateLiability(
	userId: string,
	input: { id: string } & Partial<
		Omit<
			Liability,
			| "id"
			| "userId"
			| "createdAt"
			| "updatedAt"
			| "currentBalanceMinor"
			| "balanceAsOf"
		>
	>,
): Promise<Liability> {
	const { id, ...patch } = input;
	await assertLinkedReferences(userId, patch);
	const existing = await getLiability(userId, id);
	// Net worth keeps an inactive liability only up to its end date, so an
	// inactive one needs an end that is not in the future. The dialog always
	// sends the field, as null when empty: an end left empty then dropped the
	// debt from every past month too, and a loan's contractual term end (a
	// mortgage running to 2040) kept a closed debt in today's net worth.
	if (patch.isActive === false) {
		const today = todayIso();
		const end = patch.endDate !== undefined ? patch.endDate : existing.endDate;
		if (!end || (existing.isActive && end > today)) patch.endDate = today;
	}
	const startDate = patch.startDate ?? existing.startDate;
	const endDate = patch.endDate ?? existing.endDate;
	if (startDate && endDate && endDate < startDate)
		throw new ORPCError("BAD_REQUEST", {
			message: "Das Enddatum darf nicht vor dem Beginn liegen",
		});
	const [row] = await db
		.update(liabilities)
		.set(patch)
		.where(and(eq(liabilities.id, id), eq(liabilities.userId, userId)))
		.returning();
	if (!row)
		throw new ORPCError("NOT_FOUND", {
			message: "Verbindlichkeit nicht gefunden",
		});
	return row;
}

export async function deleteLiability(
	userId: string,
	id: string,
): Promise<void> {
	await db
		.delete(liabilities)
		.where(and(eq(liabilities.id, id), eq(liabilities.userId, userId)));
}

export async function recordLiabilityBalance(
	userId: string,
	input: { liabilityId: string; date: string; balanceMinor: number },
	tx: DbOrTx = db,
): Promise<void> {
	// History row and the denormalised copy on the liability must land together.
	if (tx === db)
		return db.transaction((t) => recordLiabilityBalance(userId, input, t));
	const liability = await getLiability(userId, input.liabilityId, tx);
	await tx
		.insert(liabilityBalances)
		.values({
			liabilityId: liability.id,
			date: input.date,
			balanceMinor: input.balanceMinor,
		})
		.onConflictDoUpdate({
			target: [liabilityBalances.liabilityId, liabilityBalances.date],
			set: { balanceMinor: input.balanceMinor },
		});
	const latest = await tx.query.liabilityBalances.findFirst({
		where: eq(liabilityBalances.liabilityId, liability.id),
		orderBy: [desc(liabilityBalances.date)],
	});
	if (latest) {
		await tx
			.update(liabilities)
			.set({
				currentBalanceMinor: latest.balanceMinor,
				balanceAsOf: latest.date,
			})
			.where(eq(liabilities.id, liability.id));
	}
}
