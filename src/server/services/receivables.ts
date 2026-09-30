import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { todayIso } from "@/domain/dates";
import { type DbOrTx, db } from "@/server/db";
import {
	type Receivable,
	type ReceivableBalance,
	receivableBalances,
	receivables,
} from "@/server/db/schema";

export type ReceivableRow = Receivable & { balanceCount: number };

export async function listReceivables(
	userId: string,
	options: { includeInactive?: boolean } = {},
): Promise<ReceivableRow[]> {
	const rows = await db.query.receivables.findMany({
		where: options.includeInactive
			? eq(receivables.userId, userId)
			: and(eq(receivables.userId, userId), eq(receivables.isActive, true)),
		with: { balances: { columns: { id: true } } },
		orderBy: [desc(receivables.currentBalanceMinor)],
	});
	return rows.map(({ balances, ...row }) => ({
		...row,
		balanceCount: balances.length,
	}));
}

export async function getReceivable(
	userId: string,
	id: string,
	tx: DbOrTx = db,
): Promise<Receivable & { balances: ReceivableBalance[] }> {
	const row = await tx.query.receivables.findFirst({
		where: and(eq(receivables.id, id), eq(receivables.userId, userId)),
		with: { balances: { orderBy: [asc(receivableBalances.date)] } },
	});
	if (!row)
		throw new ORPCError("NOT_FOUND", { message: "Forderung nicht gefunden" });
	return row;
}

export async function createReceivable(
	userId: string,
	input: {
		name: string;
		debtorName: string;
		currency: string;
		originalAmountMinor?: number | null;
		currentBalanceMinor: number;
		balanceDate?: string;
		interestRateBps?: number | null;
		monthlyPaymentMinor?: number | null;
		startDate?: string | null;
		dueDate?: string | null;
		section?: string | null;
		notes?: string | null;
	},
): Promise<Receivable> {
	return db.transaction(async (tx) => {
		const balanceDate = input.balanceDate ?? todayIso();
		const [row] = await tx
			.insert(receivables)
			.values({
				userId,
				name: input.name,
				debtorName: input.debtorName,
				currency: input.currency,
				originalAmountMinor: input.originalAmountMinor ?? null,
				currentBalanceMinor: input.currentBalanceMinor,
				balanceAsOf: balanceDate,
				interestRateBps: input.interestRateBps ?? null,
				monthlyPaymentMinor: input.monthlyPaymentMinor ?? null,
				startDate: input.startDate ?? null,
				dueDate: input.dueDate ?? null,
				section: input.section ?? null,
				notes: input.notes ?? null,
				isActive: input.currentBalanceMinor > 0,
				settledAt: input.currentBalanceMinor === 0 ? balanceDate : null,
			})
			.returning();
		if (
			input.startDate &&
			input.originalAmountMinor !== null &&
			input.originalAmountMinor !== undefined &&
			input.startDate < balanceDate
		) {
			await tx.insert(receivableBalances).values({
				receivableId: row.id,
				date: input.startDate,
				balanceMinor: input.originalAmountMinor,
			});
		}
		await tx.insert(receivableBalances).values({
			receivableId: row.id,
			date: balanceDate,
			balanceMinor: input.currentBalanceMinor,
		});
		return row;
	});
}

export async function updateReceivable(
	userId: string,
	input: { id: string } & Partial<
		Omit<
			Receivable,
			| "id"
			| "userId"
			| "createdAt"
			| "updatedAt"
			| "currentBalanceMinor"
			| "balanceAsOf"
		>
	>,
): Promise<Receivable> {
	const { id, ...patch } = input;
	const [row] = await db
		.update(receivables)
		.set(patch)
		.where(and(eq(receivables.id, id), eq(receivables.userId, userId)))
		.returning();
	if (!row)
		throw new ORPCError("NOT_FOUND", { message: "Forderung nicht gefunden" });
	return row;
}

export async function deleteReceivable(userId: string, id: string) {
	await db
		.delete(receivables)
		.where(and(eq(receivables.id, id), eq(receivables.userId, userId)));
}

export async function recordReceivableBalance(
	userId: string,
	input: { receivableId: string; date: string; balanceMinor: number },
	tx: DbOrTx = db,
): Promise<void> {
	// History row and the denormalised copy on the receivable land together.
	if (tx === db)
		return db.transaction((t) => recordReceivableBalance(userId, input, t));
	const receivable = await getReceivable(userId, input.receivableId, tx);
	await tx
		.insert(receivableBalances)
		.values({
			receivableId: receivable.id,
			date: input.date,
			balanceMinor: input.balanceMinor,
		})
		.onConflictDoUpdate({
			target: [receivableBalances.receivableId, receivableBalances.date],
			set: { balanceMinor: input.balanceMinor },
		});
	const latest = await tx.query.receivableBalances.findFirst({
		where: eq(receivableBalances.receivableId, receivable.id),
		orderBy: [desc(receivableBalances.date)],
	});
	if (latest) {
		await tx
			.update(receivables)
			.set({
				currentBalanceMinor: latest.balanceMinor,
				balanceAsOf: latest.date,
				isActive: latest.balanceMinor > 0,
				settledAt: latest.balanceMinor === 0 ? latest.date : null,
			})
			.where(eq(receivables.id, receivable.id));
	}
}
