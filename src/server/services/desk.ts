import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { todayIso } from "@/domain/dates";
import {
	composeDeskTasks,
	type DeskObservation,
	filedSummary,
	liquidityStructure,
} from "@/domain/desk";
import type { DeskFiled, DeskToday, LazyCash } from "@/domain/desk-contract";
import { reservePot } from "@/domain/progress";
import { db } from "@/server/db";
import { categories, contracts, transactions } from "@/server/db/schema";
import { logger } from "@/server/logger";
import { categoryReview } from "./categorisation";
import { listObservations } from "./hr-koerner";
import { dataQuality } from "./insights";
import { investmentPlan } from "./investment-advice";
import { currentNetWorthInput } from "./net-worth";

/**
 * How many uncategorised bookings one auto-filing pass reads. Far above a
 * normal sync; a first import of years of history is filed over several
 * visits rather than in one long request.
 */
const FILE_LIMIT = 2_000;

/**
 * Applies every proposal that only repeats a decision the owner already made
 * — their rule, their recurring payment, their merchant default, an unbroken
 * history — to bookings that have no category, and nothing that rests on a
 * guess. The rows are marked `auto`, so rules and detection may still
 * overwrite them, an owner edit makes them `manual`, and `unfile` can take
 * them back while they are untouched.
 *
 * Idempotent: a second call finds nothing certain left to file. The update
 * itself re-checks that the row is still uncategorised, so a concurrent edit
 * by the owner always wins.
 */
export async function fileCertain(userId: string): Promise<DeskFiled> {
	const review = await categoryReview(userId, { limit: FILE_LIMIT });
	const picks = review.certain.filter(
		(row) => row.suggestion?.certain === true,
	);
	if (picks.length === 0) return { count: 0, transactionIds: [], summary: [] };

	// Only categories the owner has. The proposal comes from their own data,
	// but a category deleted since would otherwise dangle.
	const categoryIds = [
		...new Set(picks.map((row) => row.suggestion?.categoryId as string)),
	];
	const owned = new Map(
		(
			await db
				.select({ id: categories.id, name: categories.name })
				.from(categories)
				.where(
					and(
						eq(categories.userId, userId),
						inArray(categories.id, categoryIds),
					),
				)
		).map((row) => [row.id, row.name]),
	);

	const filed = await db.transaction(async (tx) => {
		const done: { id: string; merchant: string; categoryName: string }[] = [];
		// One statement per category keeps this to a handful of round trips.
		const byCategory = new Map<string, typeof picks>();
		for (const row of picks) {
			const categoryId = row.suggestion?.categoryId as string;
			if (!owned.has(categoryId)) continue;
			byCategory.set(categoryId, [...(byCategory.get(categoryId) ?? []), row]);
		}
		for (const [categoryId, rows] of byCategory) {
			const updated = await tx
				.update(transactions)
				.set({ categoryId, categorySource: "auto" })
				.where(
					and(
						eq(transactions.userId, userId),
						inArray(
							transactions.id,
							rows.map((row) => row.id),
						),
						isNull(transactions.categoryId),
						isNull(transactions.transferGroupId),
						sql`${transactions.categorySource} is distinct from 'manual'`,
					),
				)
				.returning({ id: transactions.id });
			const updatedIds = new Set(updated.map((row) => row.id));
			for (const row of rows)
				if (updatedIds.has(row.id))
					done.push({
						id: row.id,
						merchant:
							row.merchantName ??
							row.counterpartyName ??
							row.description.slice(0, 40),
						categoryName: owned.get(categoryId) ?? "—",
					});
		}
		return done;
	});

	return {
		count: filed.length,
		transactionIds: filed.map((row) => row.id),
		summary: filedSummary(filed),
	};
}

/**
 * `fileCertain` after a bank import, where the new bookings arrive. Filing is
 * a courtesy on top of the sync: a failure is logged by class and never turns
 * a successful import into a failed one.
 */
export async function fileCertainAfterImport(
	userId: string,
): Promise<DeskFiled | null> {
	try {
		return await fileCertain(userId);
	} catch (error) {
		logger.warn("Auto-filing after import failed", {
			event: "desk.file_certain.failed",
			userId,
			errorClass: error instanceof Error ? error.name : "UnknownError",
		});
		return null;
	}
}

/**
 * Takes back what Hr. Körner filed, on the rows that are still exactly as he
 * left them. `auto` is only ever written together with its category by
 * `fileCertain` on an uncategorised row, and everything else that changes the
 * category also changes the source — an owner edit to `manual`, a rule or
 * transfer pairing to `rule` — so a row still `auto` still carries the
 * category he gave it. Anything else is left alone.
 */
export async function unfile(
	userId: string,
	transactionIds: readonly string[],
): Promise<{ cleared: number }> {
	if (transactionIds.length === 0) return { cleared: 0 };
	const rows = await db
		.update(transactions)
		.set({ categoryId: null, categorySource: null })
		.where(
			and(
				eq(transactions.userId, userId),
				inArray(transactions.id, [...transactionIds]),
				eq(transactions.categorySource, "auto"),
			),
		)
		.returning({ id: transactions.id });
	return { cleared: rows.length };
}

export async function deskToday(userId: string): Promise<DeskToday> {
	const today = todayIso();
	const [review, observationRows, quality, invest, worth, contractRows] =
		await Promise.all([
			categoryReview(userId),
			listObservations(userId),
			dataQuality(userId),
			investmentPlan(userId),
			currentNetWorthInput(userId),
			db
				.select({
					id: contracts.id,
					name: contracts.name,
					accountId: contracts.accountId,
					status: contracts.status,
					startDate: contracts.startDate,
					endDate: contracts.endDate,
					cancellationDate: contracts.cancellationDate,
					renewalDate: contracts.renewalDate,
					noticePeriodDays: contracts.noticePeriodDays,
				})
				.from(contracts)
				.where(eq(contracts.userId, userId)),
		]);
	const baseCurrency = worth.input.baseCurrency;

	// Everything still uncategorised. Normally the certain proposals have
	// just been filed and what is left is the owner's to decide; counting all
	// of them keeps the figure honest if the desk is read before filing ran.
	const open = [...review.certain, ...review.uncertain, ...review.unknown];
	const bookings = {
		open: open.length + review.remaining,
		withProposal: review.certain.length + review.uncertain.length,
		amountMinor: open
			.filter((row) => row.currency === baseCurrency)
			.reduce((sum, row) => sum + Math.abs(row.amountMinor), 0),
	};

	const now = new Date();
	const observations: DeskObservation[] = observationRows
		.filter(
			(row) =>
				row.status === "open" ||
				(row.status === "snoozed" &&
					row.snoozedUntil !== null &&
					row.snoozedUntil <= now),
		)
		.map((row) => ({
			id: row.id,
			key: row.key,
			severity: row.severity,
			title: row.title,
			explanation: row.explanation,
			impactMinor: row.impactMinor,
			currency: row.currency,
		}));

	// "Anlegen" decides what is free; the desk only names it.
	const { plan, reserve } = invest;
	const lazy: LazyCash | null =
		reserve.reserveMinor === null
			? null
			: {
					bankCashMinor: invest.bankCashMinor,
					reserveMinor: reserve.reserveMinor,
					cashTargetMinor: plan.cashTargetMinor,
					excessMinor: plan.bankFreeMinor,
				};

	const tasks = composeDeskTasks({
		today,
		baseCurrency,
		bookings,
		observations,
		freeMoney:
			invest.depotCount > 0 && plan.ready
				? { bankMinor: plan.bankFreeMinor, brokerMinor: plan.brokerFreeMinor }
				: null,
		quality: quality.entries,
	});

	return {
		asOf: today,
		baseCurrency,
		tasks,
		liquidity: liquidityStructure({
			netWorth: worth.input,
			contracts: contractRows,
			assetSyncSources: worth.assetSyncSources,
			receivableDueDates: worth.receivableDueDates,
		}),
		lazyCash: lazy,
		reservePot: reservePot(invest.bankCashMinor, reserve),
	};
}
