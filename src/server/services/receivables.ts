import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { todayIso } from "@/domain/dates";
import { type DbOrTx, db } from "@/server/db";
import {
	type Receivable,
	type ReceivableBalance,
	receivableBalances,
	receivables,
	transactions,
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
	if (receivable.sourceStatus !== "confirmed")
		throw new ORPCError("BAD_REQUEST", {
			message: "Rückzahlungen können erst nach der Buchung erfasst werden.",
		});
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

/** The debit remains the bank fact; the receivable records money owed back. */
export async function createReceivableFromTransaction(
	userId: string,
	input: {
		transactionId: string;
		name: string;
		debtorName: string;
		amountMinor: number;
		dueDate?: string | null;
	},
) {
	return db.transaction(async (tx) => {
		// Serialise two clicks so a booking cannot create two receivables.
		const [booking] = await tx
			.select()
			.from(transactions)
			.where(
				and(
					eq(transactions.userId, userId),
					eq(transactions.id, input.transactionId),
				),
			)
			.for("update");
		if (!booking)
			throw new ORPCError("NOT_FOUND", {
				message: "Transaktion nicht gefunden",
			});
		if (booking.amountMinor >= 0 || booking.transferGroupId)
			throw new ORPCError("BAD_REQUEST", {
				message: "Nur eine Ausgabe kann eine Forderung werden.",
			});
		const existing = await tx.query.receivables.findFirst({
			where: and(
				eq(receivables.userId, userId),
				eq(receivables.sourceTransactionId, booking.id),
			),
		});
		if (existing) return existing;
		if (
			!Number.isSafeInteger(input.amountMinor) ||
			input.amountMinor <= 0 ||
			input.amountMinor > -booking.amountMinor
		)
			throw new ORPCError("BAD_REQUEST", {
				message:
					"Die Forderung muss zwischen einem Cent und dem Betrag der Ausgabe liegen.",
			});
		const [row] = await tx
			.insert(receivables)
			.values({
				userId,
				sourceTransactionId: booking.id,
				sourceStatus: booking.status === "pending" ? "pending" : "confirmed",
				name: input.name,
				debtorName: input.debtorName,
				currency: booking.currency,
				originalAmountMinor: input.amountMinor,
				currentBalanceMinor: input.amountMinor,
				balanceAsOf: booking.status === "pending" ? null : booking.bookingDate,
				startDate: booking.status === "pending" ? null : booking.bookingDate,
				dueDate: input.dueDate ?? null,
			})
			.returning();
		if (booking.status === "booked")
			await tx.insert(receivableBalances).values({
				receivableId: row.id,
				date: booking.bookingDate,
				balanceMinor: input.amountMinor,
			});
		return row;
	});
}

/** Confirmation follows the real booked row, never the estimated hold date. */
export async function confirmTransactionReceivable(
	userId: string,
	transactionId: string,
	tx: DbOrTx,
) {
	const booking = await tx.query.transactions.findFirst({
		where: and(
			eq(transactions.id, transactionId),
			eq(transactions.userId, userId),
		),
	});
	if (
		booking?.status !== "booked" ||
		booking.amountMinor >= 0 ||
		booking.transferGroupId
	)
		return;
	const [claim] = await tx
		.select()
		.from(receivables)
		.where(
			and(
				eq(receivables.userId, userId),
				eq(receivables.sourceTransactionId, transactionId),
				eq(receivables.sourceStatus, "pending"),
			),
		)
		.for("update");
	if (!claim) return;
	const confirmedAmount = Math.min(
		claim.currentBalanceMinor,
		-booking.amountMinor,
	);
	await tx
		.update(receivables)
		.set({
			sourceStatus: "confirmed",
			currency: booking.currency,
			balanceAsOf: booking.bookingDate,
			startDate: booking.bookingDate,
			currentBalanceMinor: confirmedAmount,
			originalAmountMinor: confirmedAmount,
		})
		.where(eq(receivables.id, claim.id));
	await tx.insert(receivableBalances).values({
		receivableId: claim.id,
		date: booking.bookingDate,
		balanceMinor: confirmedAmount,
	});
}
