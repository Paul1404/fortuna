import { ORPCError } from "@orpc/server";
import {
	and,
	asc,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	sql,
} from "drizzle-orm";
import { addMonths, todayIso } from "@/domain/dates";
import {
	type DetectedRecurring,
	detectRecurring,
	isOverdue,
	manualPaymentFor,
	matchesRecurringBooking,
	monthlyEquivalentMinor,
} from "@/domain/recurring";
import { db } from "@/server/db";
import {
	accounts,
	categories,
	merchants,
	type RecurringPayment,
	recurringPayments,
	transactions,
} from "@/server/db/schema";
import { logger } from "@/server/logger";
import { getSettings } from "./settings";

export type RecurringRow = RecurringPayment & {
	accountName: string | null;
	categoryName: string | null;
	categorySlug: string | null;
	occurrenceCount: number;
	monthlyEquivalentMinor: number;
	overdue: boolean;
	/**
	 * Set when no booking is linked while its category has bookings in the
	 * analysis window: how many, and how many of the unlinked ones match its
	 * amount and could be linked in one step.
	 */
	unlinked: { categoryBookings: number; matches: number } | null;
};

type UnlinkedCandidate = {
	id: string;
	accountId: string;
	amountMinor: number;
	currency: string;
	categoryId: string | null;
	recurringPaymentId: string | null;
};

/**
 * Booked, non-transfer bookings in the given categories within the analysis
 * window, with the recurring payment each already belongs to.
 */
async function categoryBookings(
	userId: string,
	categoryIds: string[],
): Promise<UnlinkedCandidate[]> {
	if (!categoryIds.length) return [];
	const settings = await getSettings(userId);
	const from = addMonths(todayIso(), -Math.max(settings.analysisMonths, 14));
	return db
		.select({
			id: transactions.id,
			accountId: transactions.accountId,
			amountMinor: transactions.amountMinor,
			currency: transactions.currency,
			categoryId: transactions.categoryId,
			recurringPaymentId: transactions.recurringPaymentId,
		})
		.from(transactions)
		.where(
			and(
				eq(transactions.userId, userId),
				inArray(transactions.categoryId, categoryIds),
				isNull(transactions.transferGroupId),
				eq(transactions.status, "booked"),
				gte(transactions.bookingDate, from),
			),
		);
}

export async function listRecurring(
	userId: string,
	options: { includeInactive?: boolean } = {},
): Promise<RecurringRow[]> {
	const rows = await db
		.select({
			r: recurringPayments,
			accountName: accounts.name,
			categoryName: categories.name,
			categorySlug: categories.slug,
			occurrenceCount: sql<number>`(select count(*)::int from ${transactions} t where t.recurring_payment_id = "recurring_payments"."id")`,
		})
		.from(recurringPayments)
		.leftJoin(accounts, eq(accounts.id, recurringPayments.accountId))
		.leftJoin(categories, eq(categories.id, recurringPayments.categoryId))
		.where(
			options.includeInactive
				? eq(recurringPayments.userId, userId)
				: and(
						eq(recurringPayments.userId, userId),
						eq(recurringPayments.isActive, true),
					),
		)
		.orderBy(asc(recurringPayments.nextExpected), asc(recurringPayments.name));
	const today = todayIso();
	const orphans = rows.filter(
		(row) => row.occurrenceCount === 0 && row.r.categoryId,
	);
	const candidates = await categoryBookings(
		userId,
		Array.from(new Set(orphans.map((row) => row.r.categoryId as string))),
	);
	const unlinked = (r: RecurringPayment, occurrenceCount: number) => {
		if (occurrenceCount > 0 || !r.categoryId) return null;
		const inCategory = candidates.filter((c) => c.categoryId === r.categoryId);
		if (!inCategory.length) return null;
		return {
			categoryBookings: inCategory.length,
			matches: inCategory.filter(
				(c) => !c.recurringPaymentId && matchesRecurringBooking(r, c),
			).length,
		};
	};
	return rows.map((row) => ({
		...row.r,
		unlinked: unlinked(row.r, row.occurrenceCount),
		accountName: row.accountName,
		categoryName: row.categoryName,
		categorySlug: row.categorySlug,
		occurrenceCount: row.occurrenceCount,
		monthlyEquivalentMinor: monthlyEquivalentMinor(
			row.r.expectedAmountMinor,
			row.r.frequency,
			row.r.intervalDays ?? 30,
		),
		overdue:
			row.r.isActive && row.r.nextExpected
				? isOverdue(row.r.nextExpected, row.r.windowDays, today)
				: false,
	}));
}

type RecurringInput = Omit<
	typeof recurringPayments.$inferInsert,
	| "id"
	| "userId"
	| "createdAt"
	| "updatedAt"
	| "detectedAutomatically"
	| "matchKey"
	| "lastOccurrence"
>;

async function assertRecurringReferences(
	userId: string,
	input: { accountId?: string | null; categoryId?: string | null },
) {
	if (input.accountId) {
		const account = await db.query.accounts.findFirst({
			where: and(eq(accounts.id, input.accountId), eq(accounts.userId, userId)),
			columns: { id: true },
		});
		if (!account)
			throw new ORPCError("BAD_REQUEST", { message: "Konto nicht gefunden" });
	}
	if (input.categoryId) {
		const category = await db.query.categories.findFirst({
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
}

/**
 * Amounts are stored signed: an outflow is negative. The form signs what it
 * sends, but the Copilot and MCP tools pass the magnitude the owner said, so a
 * 22,70 € insurance premium arrived as +22,70 with direction "outflow" and
 * the forecast added it to the balance every month. The direction decides.
 */
export function signedRecurringAmount(
	direction: "inflow" | "outflow",
	amountMinor: number,
): number {
	return direction === "outflow"
		? -Math.abs(amountMinor)
		: Math.abs(amountMinor);
}

export async function createRecurring(
	userId: string,
	input: RecurringInput,
): Promise<RecurringPayment> {
	await assertRecurringReferences(userId, input);
	const [row] = await db
		.insert(recurringPayments)
		.values({
			...input,
			expectedAmountMinor: signedRecurringAmount(
				input.direction,
				input.expectedAmountMinor,
			),
			userId,
			nextExpected: input.nextExpected ?? todayIso(),
		})
		.returning();
	return row;
}

export async function updateRecurring(
	userId: string,
	input: { id: string } & Partial<RecurringInput>,
): Promise<RecurringPayment> {
	const { id, ...patch } = input;
	await assertRecurringReferences(userId, patch);
	// A patch may carry only the amount or only the direction; the sign needs
	// both, so the missing half comes from the stored row.
	if (
		patch.expectedAmountMinor !== undefined ||
		patch.direction !== undefined
	) {
		const current = await db.query.recurringPayments.findFirst({
			where: and(
				eq(recurringPayments.id, id),
				eq(recurringPayments.userId, userId),
			),
		});
		if (current)
			patch.expectedAmountMinor = signedRecurringAmount(
				patch.direction ?? current.direction,
				patch.expectedAmountMinor ?? current.expectedAmountMinor,
			);
	}
	const [row] = await db
		.update(recurringPayments)
		.set(patch)
		.where(
			and(eq(recurringPayments.id, id), eq(recurringPayments.userId, userId)),
		)
		.returning();
	if (!row)
		throw new ORPCError("NOT_FOUND", {
			message: "Wiederkehrende Zahlung nicht gefunden",
		});
	return row;
}

/**
 * Removes a payment the owner entered. A detected one is switched off
 * instead: detection runs after every import, finds the same bookings again
 * and would bring a deleted row straight back. The inactive row keeps its
 * match key, so the pattern stays recognised and stays off.
 */
export async function deleteRecurring(
	userId: string,
	id: string,
): Promise<{ deactivated: boolean }> {
	const where = and(
		eq(recurringPayments.id, id),
		eq(recurringPayments.userId, userId),
	);
	const [switchedOff] = await db
		.update(recurringPayments)
		.set({ isActive: false })
		.where(and(where, isNotNull(recurringPayments.matchKey)))
		.returning({ id: recurringPayments.id });
	if (switchedOff) return { deactivated: true };
	await db.delete(recurringPayments).where(where);
	return { deactivated: false };
}

/** Link or unlink a transaction to a recurring payment and refresh its dates. */
export async function linkTransactionToRecurring(
	userId: string,
	transactionId: string,
	recurringPaymentId: string | null,
): Promise<void> {
	await db.transaction(async (tx) => {
		if (recurringPaymentId) {
			const recurring = await tx.query.recurringPayments.findFirst({
				where: and(
					eq(recurringPayments.id, recurringPaymentId),
					eq(recurringPayments.userId, userId),
				),
				columns: { id: true },
			});
			if (!recurring)
				throw new ORPCError("BAD_REQUEST", {
					message: "Wiederkehrende Zahlung nicht gefunden",
				});
		}
		const [row] = await tx
			.update(transactions)
			.set({ recurringPaymentId })
			.where(
				and(
					eq(transactions.id, transactionId),
					eq(transactions.userId, userId),
				),
			)
			.returning({ id: transactions.id });
		if (!row)
			throw new ORPCError("NOT_FOUND", {
				message: "Transaktion nicht gefunden",
			});
		// Both the new and the previous target change, and unlinking clears the
		// last occurrence entirely, so every payment of this owner is refreshed.
		const { refreshRecurringOccurrences } = await import("./transactions");
		await refreshRecurringOccurrences(userId, tx);
	});
}

/**
 * Link the bookings that match a recurring payment which has none linked yet.
 * The candidates are recomputed here rather than taken from the request, and
 * a payment that already has bookings is left alone: this is the one-click
 * repair for an empty payment, not a second detection.
 */
export async function linkMatchingBookings(
	userId: string,
	recurringPaymentId: string,
): Promise<{ linked: number }> {
	const recurring = (
		await listRecurring(userId, { includeInactive: true })
	).find((row) => row.id === recurringPaymentId);
	if (!recurring)
		throw new ORPCError("NOT_FOUND", {
			message: "Wiederkehrende Zahlung nicht gefunden",
		});
	if (recurring.occurrenceCount > 0 || !recurring.categoryId)
		return { linked: 0 };
	const ids = (await categoryBookings(userId, [recurring.categoryId]))
		.filter(
			(candidate) =>
				!candidate.recurringPaymentId &&
				matchesRecurringBooking(recurring, candidate),
		)
		.map((candidate) => candidate.id);
	if (!ids.length) return { linked: 0 };
	await db.transaction(async (tx) => {
		await tx
			.update(transactions)
			.set({ recurringPaymentId })
			.where(
				and(
					eq(transactions.userId, userId),
					inArray(transactions.id, ids),
					isNull(transactions.recurringPaymentId),
				),
			);
		const { refreshRecurringOccurrences } = await import("./transactions");
		await refreshRecurringOccurrences(userId, tx);
	});
	return { linked: ids.length };
}

/**
 * Run detection over the analysis window and upsert results. Existing rows
 * (by match key) keep their user edits (name, category, subscription flag);
 * only amount, cadence and dates are refreshed.
 *
 * A pattern that is a payment the owner entered by hand (`manualPaymentFor`)
 * is not added again: its unlinked bookings are linked to that payment, and
 * the payment's own fields stay as the owner wrote them — only its last and
 * next dates follow the bookings, as they do for every linked payment.
 */
export async function runRecurringDetection(userId: string): Promise<{
	created: number;
	updated: number;
	candidates: DetectedRecurring[];
}> {
	const settings = await getSettings(userId);
	const from = addMonths(todayIso(), -Math.max(settings.analysisMonths, 14));
	const rows = await db
		.select({
			id: transactions.id,
			accountId: transactions.accountId,
			bookingDate: transactions.bookingDate,
			amountMinor: transactions.amountMinor,
			currency: transactions.currency,
			description: transactions.description,
			merchantName: transactions.merchantName,
			counterpartyName: transactions.counterpartyName,
			categoryId: transactions.categoryId,
			transferGroupId: transactions.transferGroupId,
			recurringPaymentId: transactions.recurringPaymentId,
		})
		.from(transactions)
		.where(
			and(
				eq(transactions.userId, userId),
				gte(transactions.bookingDate, from),
				eq(transactions.status, "booked"),
			),
		);
	const detected = detectRecurring(rows);
	const linkedTo = new Map(
		rows.flatMap((row) =>
			row.recurringPaymentId ? [[row.id, row.recurringPaymentId] as const] : [],
		),
	);
	let created = 0;
	let updated = 0;
	await db.transaction(async (tx) => {
		const existing = await tx
			.select()
			.from(recurringPayments)
			.where(eq(recurringPayments.userId, userId));
		const byKey = new Map(
			existing.filter((e) => e.matchKey).map((e) => [e.matchKey as string, e]),
		);
		// Inactive ones too: a payment the owner switched off must not come
		// back as a detected copy.
		const manual = existing.filter((e) => !e.matchKey);
		const claimed = new Set<string>();
		const subscriptionCategories = new Set(
			(
				await tx
					.select({
						id: categories.id,
						slug: categories.slug,
						parentId: categories.parentId,
					})
					.from(categories)
					.where(eq(categories.userId, userId))
			)
				.filter((c) =>
					[
						"subscriptions",
						"streaming",
						"news-media",
						"software",
						"hosting-domains",
						"fitness",
						"internet-phone",
					].includes(c.slug),
				)
				.map((c) => c.id),
		);
		for (const d of detected) {
			const current = byKey.get(d.matchKey);
			if (current) {
				await tx
					.update(recurringPayments)
					.set({
						expectedAmountMinor: d.expectedAmountMinor,
						previousAmountMinor: d.priceChange
							? -Math.abs(d.priceChange.fromMinor) *
								(d.direction === "inflow" ? -1 : 1)
							: null,
						priceChangedAt: d.priceChange?.since ?? null,
						frequency: current.detectedAutomatically
							? d.frequency
							: current.frequency,
						intervalDays: current.detectedAutomatically
							? d.intervalDays
							: current.intervalDays,
						typicalDay: d.typicalDay,
						windowDays: d.windowDays,
						lastOccurrence: d.lastOccurrence,
						nextExpected: d.nextExpected,
						categoryId: current.categoryId ?? d.categoryId,
					})
					.where(eq(recurringPayments.id, current.id));
				await tx
					.update(transactions)
					.set({ recurringPaymentId: current.id })
					.where(
						and(
							inArray(transactions.id, d.transactionIds),
							isNull(transactions.recurringPaymentId),
						),
					);
				updated += 1;
				continue;
			}
			const own = manualPaymentFor(
				d,
				manual.filter((row) => !claimed.has(row.id)),
				linkedTo,
			);
			if (own) {
				claimed.add(own);
				await tx
					.update(transactions)
					.set({ recurringPaymentId: own })
					.where(
						and(
							eq(transactions.userId, userId),
							inArray(transactions.id, d.transactionIds),
							isNull(transactions.recurringPaymentId),
						),
					);
				updated += 1;
				continue;
			}
			const merchant = await tx.query.merchants.findFirst({
				where: and(
					eq(merchants.userId, userId),
					eq(merchants.normalizedName, d.name.toLowerCase()),
				),
			});
			const [row] = await tx
				.insert(recurringPayments)
				.values({
					userId,
					name: d.name,
					merchantId: merchant?.id ?? null,
					categoryId: d.categoryId,
					accountId: d.accountId,
					direction: d.direction,
					expectedAmountMinor: d.expectedAmountMinor,
					previousAmountMinor: d.priceChange
						? -Math.abs(d.priceChange.fromMinor) *
							(d.direction === "inflow" ? -1 : 1)
						: null,
					priceChangedAt: d.priceChange?.since ?? null,
					currency: d.currency,
					frequency: d.frequency,
					intervalDays: d.intervalDays,
					typicalDay: d.typicalDay,
					windowDays: d.windowDays,
					lastOccurrence: d.lastOccurrence,
					nextExpected: d.nextExpected,
					isSubscription:
						d.direction === "outflow" &&
						d.categoryId !== null &&
						subscriptionCategories.has(d.categoryId),
					detectedAutomatically: true,
					matchKey: d.matchKey,
				})
				.returning();
			await tx
				.update(transactions)
				.set({ recurringPaymentId: row.id })
				.where(
					and(
						inArray(transactions.id, d.transactionIds),
						isNull(transactions.recurringPaymentId),
					),
				);
			created += 1;
		}
		const { refreshRecurringOccurrences } = await import("./transactions");
		await refreshRecurringOccurrences(userId, tx);
	});
	return { created, updated, candidates: detected };
}

/**
 * Detection after an import, where new bookings arrive. It used to run only
 * when the owner pressed "Erkennen" on /fixed-costs, so an owner who never
 * pressed it had no detected payment at all however many monthly bookings
 * the bank delivered. A courtesy on top of the import: a failure is logged by
 * class and never fails the import.
 */
export async function detectRecurringAfterImport(
	userId: string,
): Promise<void> {
	try {
		await runRecurringDetection(userId);
	} catch (error) {
		logger.warn("Recurring detection after import failed", {
			event: "recurring.detect_after_import.failed",
			userId,
			errorClass: error instanceof Error ? error.name : "UnknownError",
		});
	}
}

export async function upcomingRecurring(
	userId: string,
	days = 30,
): Promise<(RecurringRow & { dueDate: string })[]> {
	const rows = await listRecurring(userId);
	const today = todayIso();
	const horizon = addDaysIso(today, days);
	return rows
		.filter((r) => r.nextExpected && r.nextExpected <= horizon)
		.map((r) => ({ ...r, dueDate: r.nextExpected as string }))
		.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function addDaysIso(date: string, days: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

export { desc };
