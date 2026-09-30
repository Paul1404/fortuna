import { randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/server";
import {
	and,
	asc,
	desc,
	eq,
	gte,
	ilike,
	inArray,
	isNotNull,
	isNull,
	lte,
	ne,
	or,
	sql,
} from "drizzle-orm";
import { addDays } from "@/domain/dates";
import { transactionFingerprint } from "@/domain/fingerprint";
import { isEmptyBookingText, merchantKey, titleCase } from "@/domain/normalize";
import { applyRules } from "@/domain/rules";
import { detectInternalTransfers } from "@/domain/transfers";
import type { TransactionFilterInput } from "@/lib/schemas";
import { type DbOrTx, db } from "@/server/db";
import {
	accounts,
	categories,
	categorizationRules,
	recurringPayments,
	type Transaction,
	transactions,
} from "@/server/db/schema";
import { getAccount, ownIbans, recomputeAccountBalance } from "./accounts";
import { upsertMerchant } from "./merchants";
import { loadRules } from "./rules";

export type TransactionRow = Transaction & {
	accountName: string;
	categoryName: string | null;
	categoryIcon: string | null;
	parentCategoryName: string | null;
	recurringName: string | null;
};

const rowSelect = {
	tx: transactions,
	accountName: accounts.name,
	categoryName: categories.name,
	categoryIcon: categories.icon,
	parentCategoryName: sql<
		string | null
	>`(select p.name from ${categories} p where p.id = "categories"."parent_id")`,
	recurringName: recurringPayments.name,
};

function toRow(r: {
	tx: Transaction;
	accountName: string;
	categoryName: string | null;
	categoryIcon: string | null;
	parentCategoryName: string | null;
	recurringName: string | null;
}): TransactionRow {
	return {
		...r.tx,
		accountName: r.accountName,
		categoryName: r.categoryName,
		categoryIcon: r.categoryIcon,
		parentCategoryName: r.parentCategoryName,
		recurringName: r.recurringName,
	};
}

function filterConditions(userId: string, f: TransactionFilterInput) {
	const c = [eq(transactions.userId, userId)];
	if (f.accountId) c.push(eq(transactions.accountId, f.accountId));
	if (f.categoryId) {
		c.push(
			or(
				eq(transactions.categoryId, f.categoryId),
				sql`${transactions.categoryId} in (select id from ${categories} where parent_id = ${f.categoryId})`,
			) as ReturnType<typeof eq>,
		);
	}
	if (f.uncategorised) c.push(isNull(transactions.categoryId));
	if (f.from) c.push(gte(transactions.bookingDate, f.from));
	if (f.to) c.push(lte(transactions.bookingDate, f.to));
	if (f.direction === "inflow") c.push(gte(transactions.amountMinor, 0));
	if (f.direction === "outflow") c.push(lte(transactions.amountMinor, -1));
	if (f.includeTransfers === false)
		c.push(isNull(transactions.transferGroupId));
	if (f.recurringPaymentId)
		c.push(eq(transactions.recurringPaymentId, f.recurringPaymentId));
	if (f.merchantId) c.push(eq(transactions.merchantId, f.merchantId));
	if (f.status) c.push(eq(transactions.status, f.status));
	if (f.q?.trim()) {
		const pattern = `%${f.q.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
		c.push(
			or(
				ilike(transactions.description, pattern),
				ilike(transactions.merchantName, pattern),
				ilike(transactions.counterpartyName, pattern),
				ilike(transactions.notes, pattern),
			) as ReturnType<typeof eq>,
		);
	}
	return and(...c);
}

export async function listTransactions(
	userId: string,
	filter: TransactionFilterInput,
): Promise<{ rows: TransactionRow[]; total: number; sumMinor: number }> {
	const where = filterConditions(userId, filter);
	const order =
		filter.sort === "date_asc"
			? [asc(transactions.bookingDate), asc(transactions.createdAt)]
			: filter.sort === "amount_desc"
				? // A second key keeps equal amounts in the same order across pages.
					[desc(transactions.amountMinor), desc(transactions.createdAt)]
				: filter.sort === "amount_asc"
					? [asc(transactions.amountMinor), asc(transactions.createdAt)]
					: [desc(transactions.bookingDate), desc(transactions.createdAt)];
	const [rows, [agg]] = await Promise.all([
		db
			.select(rowSelect)
			.from(transactions)
			.innerJoin(accounts, eq(accounts.id, transactions.accountId))
			.leftJoin(categories, eq(categories.id, transactions.categoryId))
			.leftJoin(
				recurringPayments,
				eq(recurringPayments.id, transactions.recurringPaymentId),
			)
			.where(where)
			.orderBy(...order)
			.limit(filter.limit ?? 100)
			.offset(filter.offset ?? 0),
		db
			.select({
				total: sql<number>`count(*)::int`,
				sum: sql<number>`coalesce(sum(${transactions.amountMinor}), 0)::bigint`,
			})
			.from(transactions)
			.where(where),
	]);
	return { rows: rows.map(toRow), total: agg.total, sumMinor: Number(agg.sum) };
}

export async function getTransaction(
	userId: string,
	id: string,
): Promise<TransactionRow> {
	const [row] = await db
		.select(rowSelect)
		.from(transactions)
		.innerJoin(accounts, eq(accounts.id, transactions.accountId))
		.leftJoin(categories, eq(categories.id, transactions.categoryId))
		.leftJoin(
			recurringPayments,
			eq(recurringPayments.id, transactions.recurringPaymentId),
		)
		.where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
	if (!row)
		throw new ORPCError("NOT_FOUND", { message: "Transaktion nicht gefunden" });
	return toRow(row);
}

export type IncomingTransaction = {
	bookingDate: string;
	valueDate?: string | null;
	amountMinor: number;
	currency?: string | null;
	description: string;
	counterpartyName?: string | null;
	counterpartyIban?: string | null;
	externalId?: string | null;
	type?: Transaction["type"];
	status?: Transaction["status"];
	categoryId?: string | null;
	notes?: string | null;
};

export type InsertResult = {
	inserted: string[];
	duplicates: number;
	/** Bookings whose altered text this read restored from the bank. */
	restored?: number;
};

/**
 * A stored booking text a re-read may replace: nothing, a bare ISO code, or a
 * placeholder. The same set as `isEmptyBookingText`, in SQL.
 *
 * Built with `or()` rather than one raw fragment on purpose. Drizzle's `and()`
 * does not parenthesise a raw `sql` chunk, so "a and b and x or y or z" let the
 * trailing alternatives escape the account, user and external-id filter, and a
 * single duplicate rewrote every placeholder booking in the table.
 */
export function storedTextSaysNothing() {
	return or(
		isNull(transactions.description),
		eq(transactions.description, ""),
		sql`${transactions.description} ~ '^[A-Z]{4}$'`,
		inArray(transactions.description, [
			"Ohne Verwendungszweck",
			"Banktransaktion",
		]),
	);
}

type StoredContent = {
	bookingDate: string;
	amountMinor: number;
	currency: string;
	description: string;
	counterpartyIban: string | null;
	fingerprint: string;
};

/**
 * Whether a stored booking's text was changed behind its fingerprint. Every
 * edit the owner or Hr. Körner makes goes through `updateTransaction`, which
 * recomputes the fingerprint; only a raw update leaves it stale. From
 * 19.09.2026 until 0.52.3 such an update copied another booking's text,
 * merchant and counterparty onto every placeholder booking, so a stale
 * fingerprint marks a text the owner never wrote.
 */
export function textAlteredBehindFingerprint(row: StoredContent): boolean {
	return (
		transactionFingerprint({
			bookingDate: row.bookingDate,
			amountMinor: row.amountMinor,
			currency: row.currency,
			description: row.description,
			counterpartyIban: row.counterpartyIban,
		}) !== row.fingerprint
	);
}

/**
 * The oldest booking date on an account whose provider text was altered
 * behind its fingerprint, so a sync can read back far enough to restore it.
 */
export async function alteredTextSince(
	accountId: string,
	dbx: DbOrTx = db,
): Promise<string | null> {
	const rows = await dbx
		.select({
			bookingDate: transactions.bookingDate,
			amountMinor: transactions.amountMinor,
			currency: transactions.currency,
			description: transactions.description,
			counterpartyIban: transactions.counterpartyIban,
			fingerprint: transactions.fingerprint,
		})
		.from(transactions)
		.where(
			and(
				eq(transactions.accountId, accountId),
				isNotNull(transactions.externalId),
			),
		);
	let oldest: string | null = null;
	for (const row of rows)
		if (
			textAlteredBehindFingerprint(row) &&
			(!oldest || row.bookingDate < oldest)
		)
			oldest = row.bookingDate;
	return oldest;
}

/**
 * Idempotent bulk insert for one account. Rows already present (by external id
 * or content fingerprint) are skipped. Rules, merchants, recurring links and
 * transfer detection run for the newly inserted rows; the account balance is
 * moved forward for rows newer than its last observation.
 */
export async function insertTransactions(
	userId: string,
	accountId: string,
	rows: readonly IncomingTransaction[],
	meta: { importSource: string; importJobId?: string | null },
	tx: DbOrTx = db,
): Promise<InsertResult> {
	const account = await getAccount(userId, accountId, tx);
	const rules = await loadRules(userId, tx);
	const recurring = await tx
		.select({
			id: recurringPayments.id,
			matchKey: recurringPayments.matchKey,
			accountId: recurringPayments.accountId,
			categoryId: recurringPayments.categoryId,
		})
		.from(recurringPayments)
		.where(
			and(
				eq(recurringPayments.userId, userId),
				eq(recurringPayments.isActive, true),
			),
		);
	const recurringByKey = new Map(
		recurring.filter((r) => r.matchKey).map((r) => [r.matchKey as string, r]),
	);
	const merchantCache = new Map<string, { id: string; name: string }>();
	const inserted: string[] = [];
	let duplicates = 0;
	/** Held (pending) rows this read reported as booked. */
	let promoted = 0;
	/** Bookings whose altered text this read put back. */
	let restored = 0;
	const ruleHits = new Map<string, number>();

	for (const incoming of rows) {
		const currency = (incoming.currency ?? account.currency).toUpperCase();
		const fingerprint = transactionFingerprint({
			bookingDate: incoming.bookingDate,
			amountMinor: incoming.amountMinor,
			currency,
			description: incoming.description,
			counterpartyIban: incoming.counterpartyIban,
		});
		const subject = {
			accountId,
			description: incoming.description,
			counterpartyName: incoming.counterpartyName,
			counterpartyIban: incoming.counterpartyIban,
			amountMinor: incoming.amountMinor,
		};
		const match = applyRules(rules, subject);
		let merchantName = match?.merchantName ?? incoming.counterpartyName ?? null;
		if (!merchantName && !isEmptyBookingText(incoming.description)) {
			const key = merchantKey(null, incoming.description);
			merchantName = key ? titleCase(key) : null;
		}
		let merchantId: string | null = null;
		if (merchantName) {
			const cached = merchantCache.get(merchantName.toLowerCase());
			const m = cached ?? (await upsertMerchant(userId, merchantName, tx));
			merchantCache.set(merchantName.toLowerCase(), m);
			merchantId = m.id;
			merchantName = m.name;
		}
		const key = `${accountId}|${incoming.amountMinor < 0 ? "out" : "in"}|${currency}|${merchantKey(merchantName ?? incoming.counterpartyName, incoming.description)}`;
		const rec = recurringByKey.get(key);
		const categoryId =
			incoming.categoryId ?? match?.categoryId ?? rec?.categoryId ?? null;
		const categorySource = incoming.categoryId
			? ("manual" as const)
			: match
				? ("rule" as const)
				: rec?.categoryId
					? ("recurring" as const)
					: null;

		const [row] = await tx
			.insert(transactions)
			.values({
				userId,
				accountId,
				bookingDate: incoming.bookingDate,
				valueDate: incoming.valueDate ?? null,
				amountMinor: incoming.amountMinor,
				currency,
				description: incoming.description,
				counterpartyName: incoming.counterpartyName ?? null,
				counterpartyIban: incoming.counterpartyIban ?? null,
				merchantId,
				merchantName,
				categoryId,
				categorySource,
				type:
					incoming.type ?? (incoming.amountMinor >= 0 ? "income" : "payment"),
				status: incoming.status ?? "booked",
				recurringPaymentId: rec?.id ?? null,
				notes: incoming.notes ?? null,
				externalId: incoming.externalId ?? null,
				importSource: meta.importSource,
				importJobId: meta.importJobId ?? null,
				fingerprint,
			})
			.onConflictDoNothing()
			.returning({ id: transactions.id });
		if (!row) {
			duplicates += 1;
			// A bank reports a card payment as pending first and books it days
			// later under the same reference or with the same content. Skipped as
			// a duplicate, the booked version never landed: the row stayed pending
			// for good and was left out of cashflow and the balance. The booking
			// is the fact, so the held row becomes it.
			if ((incoming.status ?? "booked") === "booked") {
				const [held] = await tx
					.select({
						id: transactions.id,
						fingerprint: transactions.fingerprint,
						transferGroupId: transactions.transferGroupId,
					})
					.from(transactions)
					.where(
						and(
							eq(transactions.userId, userId),
							eq(transactions.accountId, accountId),
							eq(transactions.status, "pending"),
							incoming.externalId
								? or(
										eq(transactions.externalId, incoming.externalId),
										eq(transactions.fingerprint, fingerprint),
									)
								: eq(transactions.fingerprint, fingerprint),
						),
					)
					.limit(1);
				if (held) {
					// The booked date and amount win, unless another row already
					// carries that content (the fingerprint is unique per account)
					// or the row is one leg of a pair whose amounts must match.
					const clash =
						Boolean(held.transferGroupId) ||
						(held.fingerprint !== fingerprint &&
							(await tx.query.transactions.findFirst({
								where: and(
									eq(transactions.accountId, accountId),
									eq(transactions.fingerprint, fingerprint),
								),
								columns: { id: true },
							})));
					await tx
						.update(transactions)
						.set({
							status: "booked",
							...(clash
								? {}
								: {
										bookingDate: incoming.bookingDate,
										valueDate: incoming.valueDate ?? null,
										amountMinor: incoming.amountMinor,
										fingerprint,
									}),
						})
						.where(eq(transactions.id, held.id));
					promoted += 1;
				}
			}
			// A text changed behind its fingerprint was never the owner's (see
			// textAlteredBehindFingerprint). The bank's own text, merchant and
			// counterparty go back; amount, date, category and notes stay.
			if (incoming.externalId) {
				const stored = await tx.query.transactions.findFirst({
					where: and(
						eq(transactions.userId, userId),
						eq(transactions.accountId, accountId),
						eq(transactions.externalId, incoming.externalId),
					),
				});
				if (stored && textAlteredBehindFingerprint(stored)) {
					const restore = stored.description !== incoming.description;
					const description = restore
						? incoming.description
						: stored.description;
					const next = transactionFingerprint({
						bookingDate: stored.bookingDate,
						amountMinor: stored.amountMinor,
						currency: stored.currency,
						description,
						counterpartyIban: stored.counterpartyIban,
					});
					// The fingerprint is unique per account; heal it only where no
					// other booking already carries that content.
					const taken = await tx.query.transactions.findFirst({
						where: and(
							eq(transactions.accountId, accountId),
							eq(transactions.fingerprint, next),
							ne(transactions.id, stored.id),
						),
						columns: { id: true },
					});
					await tx
						.update(transactions)
						.set({
							...(restore
								? {
										description,
										merchantName,
										merchantId,
										counterpartyName: incoming.counterpartyName ?? null,
									}
								: {}),
							...(taken ? {} : { fingerprint: next }),
						})
						.where(eq(transactions.id, stored.id));
					if (restore) restored += 1;
					continue;
				}
			}
			// The booking is already here, but its text may have been one the
			// bank could not fill in yet — "PMNT", or the owner's own name. When
			// a later read brings something real, take it. Only a text that says
			// nothing is replaced, so anything the owner typed is safe without
			// needing a flag to prove it.
			if (
				incoming.externalId &&
				!isEmptyBookingText(incoming.description) &&
				merchantName
			)
				await tx
					.update(transactions)
					.set({
						description: incoming.description,
						merchantName,
						merchantId,
						counterpartyName: incoming.counterpartyName ?? null,
					})
					.where(
						and(
							eq(transactions.userId, userId),
							eq(transactions.accountId, accountId),
							eq(transactions.externalId, incoming.externalId),
							storedTextSaysNothing(),
						),
					);
			continue;
		}
		inserted.push(row.id);
		if (match)
			ruleHits.set(match.ruleId, (ruleHits.get(match.ruleId) ?? 0) + 1);
	}

	for (const [ruleId, n] of ruleHits) {
		await tx
			.update(categorizationRules)
			.set({ matchCount: sql`${categorizationRules.matchCount} + ${n}` })
			.where(eq(categorizationRules.id, ruleId));
	}
	if (inserted.length > 0 || promoted > 0) {
		await recomputeAccountBalance(userId, accountId, tx);
		// A historical import brings old rows, so the window follows the data
		// rather than today; the counterpart can only be three days away.
		const earliest = rows.reduce(
			(oldest, row) => (row.bookingDate < oldest ? row.bookingDate : oldest),
			rows[0].bookingDate,
		);
		await detectAndLinkTransfers(userId, tx, addDays(earliest, -90));
		await refreshRecurringOccurrences(userId, tx);
	}
	return { inserted, duplicates, restored };
}

export async function createTransaction(
	userId: string,
	input: IncomingTransaction & { accountId: string },
): Promise<TransactionRow> {
	const { accountId, ...rest } = input;
	if (rest.categoryId) {
		const category = await db.query.categories.findFirst({
			where: and(
				eq(categories.id, rest.categoryId),
				eq(categories.userId, userId),
			),
			columns: { id: true },
		});
		if (!category)
			throw new ORPCError("BAD_REQUEST", {
				message: "Kategorie nicht gefunden",
			});
	}
	const result = await db.transaction((tx) =>
		insertTransactions(
			userId,
			accountId,
			[rest],
			{ importSource: "manual" },
			tx,
		),
	);
	if (result.inserted.length === 0)
		throw new ORPCError("CONFLICT", {
			message:
				"Auf diesem Konto ist bereits eine identische Transaktion vorhanden",
		});
	return getTransaction(userId, result.inserted[0]);
}

export async function updateTransaction(
	userId: string,
	input: {
		id: string;
		categoryId?: string | null;
		merchantName?: string | null;
		notes?: string | null;
		description?: string;
		bookingDate?: string;
		amountMinor?: number;
		status?: Transaction["status"];
		recurringPaymentId?: string | null;
		createRule?: boolean;
	},
): Promise<TransactionRow & { ruleApplied: number }> {
	/** Bookings the new rule recategorised, so the page can say so. */
	let ruleApplied = 0;
	await db.transaction(async (tx) => {
		const existing = await tx.query.transactions.findFirst({
			where: and(
				eq(transactions.id, input.id),
				eq(transactions.userId, userId),
			),
		});
		if (!existing)
			throw new ORPCError("NOT_FOUND", {
				message: "Transaktion nicht gefunden",
			});
		if (input.categoryId) {
			const category = await tx.query.categories.findFirst({
				where: and(
					eq(categories.id, input.categoryId),
					eq(categories.userId, userId),
				),
				columns: { id: true },
			});
			if (!category)
				throw new ORPCError("BAD_REQUEST", {
					message: "Kategorie nicht gefunden",
				});
		}
		if (input.recurringPaymentId) {
			const recurring = await tx.query.recurringPayments.findFirst({
				where: and(
					eq(recurringPayments.id, input.recurringPaymentId),
					eq(recurringPayments.userId, userId),
				),
				columns: { id: true },
			});
			if (!recurring)
				throw new ORPCError("BAD_REQUEST", {
					message: "Wiederkehrende Zahlung nicht gefunden",
				});
		}
		const patch: Partial<typeof transactions.$inferInsert> = {};
		if (input.categoryId !== undefined) {
			patch.categoryId = input.categoryId;
			patch.categorySource = input.categoryId ? "manual" : null;
		}
		if (input.merchantName !== undefined) {
			if (input.merchantName) {
				const m = await upsertMerchant(userId, input.merchantName, tx);
				patch.merchantId = m.id;
				patch.merchantName = m.name;
			} else {
				patch.merchantId = null;
				patch.merchantName = null;
			}
		}
		if (input.notes !== undefined) patch.notes = input.notes;
		if (input.description !== undefined) patch.description = input.description;
		if (input.bookingDate !== undefined) patch.bookingDate = input.bookingDate;
		if (input.status !== undefined) patch.status = input.status;
		if (input.recurringPaymentId !== undefined)
			patch.recurringPaymentId = input.recurringPaymentId;
		if (
			input.amountMinor !== undefined &&
			input.amountMinor !== existing.amountMinor
		)
			patch.amountMinor = input.amountMinor;
		if (
			patch.bookingDate ||
			patch.amountMinor !== undefined ||
			patch.description
		) {
			patch.fingerprint = transactionFingerprint({
				bookingDate: patch.bookingDate ?? existing.bookingDate,
				amountMinor: patch.amountMinor ?? existing.amountMinor,
				currency: existing.currency,
				description: patch.description ?? existing.description,
				counterpartyIban: existing.counterpartyIban,
			});
		}
		// A pair only holds while both legs are booked and offset each other. Once
		// an edit breaks that, keeping the group would hide the difference from
		// cashflow, so the pair is released the same way an explicit unlink does.
		// Released before the patch so an edit that also sets a category wins.
		if (
			existing.transferGroupId &&
			((patch.amountMinor !== undefined &&
				patch.amountMinor !== existing.amountMinor) ||
				(input.status !== undefined && input.status !== "booked"))
		) {
			await tx
				.update(transactions)
				.set({
					transferGroupId: null,
					type: "payment",
					categoryId: null,
					categorySource: null,
				})
				.where(eq(transactions.transferGroupId, existing.transferGroupId));
		}
		await tx
			.update(transactions)
			.set(patch)
			.where(eq(transactions.id, input.id));
		if (
			input.amountMinor !== undefined ||
			input.bookingDate !== undefined ||
			input.status !== undefined
		)
			await recomputeAccountBalance(userId, existing.accountId, tx);
		if (
			input.recurringPaymentId !== undefined ||
			input.bookingDate !== undefined ||
			input.status !== undefined
		)
			await refreshRecurringOccurrences(userId, tx);

		if (input.createRule && input.categoryId) {
			const needle = (
				input.merchantName ??
				existing.merchantName ??
				existing.counterpartyName ??
				merchantKey(null, existing.description)
			).trim();
			if (needle) {
				const [rule] = await tx
					.insert(categorizationRules)
					.values({
						userId,
						// Named like the rules the seed creates: the merchant, nothing
						// else. "Kiosk → Kategorie" read like a machine had written it.
						name: needle,
						priority: 50,
						merchantContains: needle,
						direction: existing.amountMinor < 0 ? "outflow" : "inflow",
						categoryId: input.categoryId,
					})
					.returning();
				// Apply to other uncategorised rows from the same merchant right away.
				const applied = await tx
					.update(transactions)
					.set({ categoryId: input.categoryId, categorySource: "rule" })
					.where(
						and(
							eq(transactions.userId, userId),
							isNull(transactions.categoryId),
							or(
								ilike(transactions.merchantName, `%${needle}%`),
								ilike(transactions.counterpartyName, `%${needle}%`),
								ilike(transactions.description, `%${needle}%`),
							),
						),
					)
					.returning({ id: transactions.id });
				// The rules page reports a rule's work as "Treffer". Leaving this
				// path out made a rule that had just recategorised a dozen bookings
				// read "0" there, so anyone checking concluded it was broken.
				if (applied.length > 0 && rule)
					await tx
						.update(categorizationRules)
						.set({
							matchCount: sql`${categorizationRules.matchCount} + ${applied.length}`,
						})
						.where(eq(categorizationRules.id, rule.id));
				ruleApplied = applied.length;
			}
		}
	});
	return { ...(await getTransaction(userId, input.id)), ruleApplied };
}

export async function deleteTransaction(
	userId: string,
	id: string,
): Promise<void> {
	await db.transaction(async (tx) => {
		const existing = await tx.query.transactions.findFirst({
			where: and(eq(transactions.id, id), eq(transactions.userId, userId)),
		});
		if (!existing)
			throw new ORPCError("NOT_FOUND", {
				message: "Transaktion nicht gefunden",
			});
		if (existing.transferGroupId) {
			// The survivor is a normal booking again: leaving type and category as
			// "transfer" would keep real money out of cashflow forever.
			await tx
				.update(transactions)
				.set({
					transferGroupId: null,
					type: "payment",
					categoryId: null,
					categorySource: null,
				})
				.where(eq(transactions.transferGroupId, existing.transferGroupId));
		}
		await tx.delete(transactions).where(eq(transactions.id, id));
		await recomputeAccountBalance(userId, existing.accountId, tx);
		await refreshRecurringOccurrences(userId, tx);
	});
}

/** Explicitly link two legs as an internal transfer (or unlink with one id). */
export async function linkTransfer(
	userId: string,
	outflowId: string,
	inflowId: string,
): Promise<void> {
	await db.transaction(async (tx) => {
		const legs = await tx
			.select()
			.from(transactions)
			.where(
				and(
					eq(transactions.userId, userId),
					inArray(transactions.id, [outflowId, inflowId]),
				),
			);
		if (legs.length !== 2)
			throw new ORPCError("NOT_FOUND", {
				message: "Beide Transaktionen müssen vorhanden sein",
			});
		const outflow = legs.find((leg) => leg.id === outflowId);
		const inflow = legs.find((leg) => leg.id === inflowId);
		if (
			!outflow ||
			!inflow ||
			outflow.accountId === inflow.accountId ||
			outflow.status !== "booked" ||
			inflow.status !== "booked" ||
			outflow.amountMinor >= 0 ||
			inflow.amountMinor <= 0 ||
			outflow.currency !== inflow.currency ||
			Math.abs(outflow.amountMinor) !== inflow.amountMinor
		)
			throw new ORPCError("BAD_REQUEST", {
				message:
					"Eine Umbuchung braucht zwei gebuchte Gegenbuchungen gleicher Währung und Höhe auf verschiedenen Konten",
			});
		const groupId = randomUUID();
		const transferCategory = await tx.query.categories.findFirst({
			where: and(
				eq(categories.userId, userId),
				eq(categories.slug, "transfers"),
			),
		});
		await tx
			.update(transactions)
			.set({
				transferGroupId: groupId,
				type: "transfer",
				categoryId: transferCategory?.id ?? null,
				categorySource: "manual",
				recurringPaymentId: null,
			})
			.where(inArray(transactions.id, [outflowId, inflowId]));
	});
}

export async function unlinkTransfer(
	userId: string,
	id: string,
): Promise<void> {
	await db.transaction(async (tx) => {
		const row = await tx.query.transactions.findFirst({
			where: and(eq(transactions.id, id), eq(transactions.userId, userId)),
		});
		if (!row?.transferGroupId) return;
		await tx
			.update(transactions)
			.set({
				transferGroupId: null,
				type: "payment",
				categoryId: null,
				categorySource: null,
			})
			.where(eq(transactions.transferGroupId, row.transferGroupId));
	});
}

/** Pair unlinked legs across own accounts. Safe to run repeatedly. */
/**
 * Pair the two legs of an internal transfer.
 *
 * `since` bounds the scan. Every import and every bank sync calls this, and an
 * unbounded scan reads the owner's whole unpaired history each time, which only
 * grows. Pairing itself never looks further than three days apart, so a window
 * around the rows that just arrived finds everything a full scan would. Omit it
 * for the deliberate "Umbuchungen erkennen" pass over all history.
 */
export async function detectAndLinkTransfers(
	userId: string,
	tx: DbOrTx = db,
	since?: string,
): Promise<number> {
	const candidates = await tx
		.select({
			id: transactions.id,
			accountId: transactions.accountId,
			bookingDate: transactions.bookingDate,
			amountMinor: transactions.amountMinor,
			currency: transactions.currency,
			counterpartyIban: transactions.counterpartyIban,
			transferGroupId: transactions.transferGroupId,
			categorySource: transactions.categorySource,
		})
		.from(transactions)
		.where(
			and(
				eq(transactions.userId, userId),
				isNull(transactions.transferGroupId),
				// The same rule as linking by hand: a pair holds only while both
				// legs are booked. A pending leg is out of cashflow anyway and may
				// still change amount or vanish.
				eq(transactions.status, "booked"),
				...(since ? [gte(transactions.bookingDate, since)] : []),
			),
		);
	const pairs = detectInternalTransfers(
		candidates.filter((c) => c.categorySource !== "manual"),
		await ownIbans(userId, tx),
	);
	if (pairs.length === 0) return 0;
	const transferCategory = await tx.query.categories.findFirst({
		where: and(eq(categories.userId, userId), eq(categories.slug, "transfers")),
	});
	for (const pair of pairs) {
		await tx
			.update(transactions)
			.set({
				transferGroupId: randomUUID(),
				type: "transfer",
				categoryId: transferCategory?.id ?? null,
				categorySource: "rule",
				recurringPaymentId: null,
			})
			.where(inArray(transactions.id, [pair.outflowId, pair.inflowId]));
	}
	return pairs.length;
}

/** Keep recurring rows' last/next dates in line with their linked bookings. */
export async function refreshRecurringOccurrences(
	userId: string,
	tx: DbOrTx = db,
): Promise<void> {
	const { nextExpectedDate } = await import("@/domain/recurring");
	const rows = await tx
		.select({
			id: recurringPayments.id,
			frequency: recurringPayments.frequency,
			intervalDays: recurringPayments.intervalDays,
			typicalDay: recurringPayments.typicalDay,
			matchKey: recurringPayments.matchKey,
			last: sql<
				string | null
			>`(select max(t.booking_date)::text from ${transactions} t where t.recurring_payment_id = "recurring_payments"."id" and t.status = 'booked')`,
		})
		.from(recurringPayments)
		.where(eq(recurringPayments.userId, userId));
	for (const r of rows) {
		// A booked occurrence is the one fact that outranks anything stored, so
		// it rolls the date forward. Without one there is nothing to derive from:
		// clearing the date anyway used to wipe the due date the owner typed for
		// a yearly insurance on every import, and the forecast then charged it on
		// day 0 because it falls back to today for a missing date. Only a
		// detected row (one with a match key) may lose its date that way.
		const nextExpected = r.last
			? nextExpectedDate(
					r.last,
					r.frequency,
					r.intervalDays ?? 30,
					r.typicalDay,
				)
			: r.matchKey
				? null
				: undefined;
		await tx
			.update(recurringPayments)
			.set({
				lastOccurrence: r.last,
				...(nextExpected === undefined ? {} : { nextExpected }),
			})
			.where(
				and(
					eq(recurringPayments.id, r.id),
					eq(recurringPayments.userId, userId),
				),
			);
	}
}
