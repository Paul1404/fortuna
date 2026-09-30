import { ORPCError } from "@orpc/server";
import {
	and,
	count,
	desc,
	eq,
	gte,
	inArray,
	lte,
	notInArray,
} from "drizzle-orm";
import {
	classifyBrokerTransactionRevision,
	classifyInvestmentSyncFailure,
	preferredSourceAccounts,
} from "@/domain/investment-source";
import { encryptSecret } from "@/server/crypto";
import { db } from "@/server/db";
import {
	accounts,
	investmentSourceAccounts,
	investmentSourcePositions,
	investmentSourceTransactionRevisions,
	investmentSourceTransactions,
} from "@/server/db/schema";
import { logger } from "@/server/logger";
import {
	parseScalableCliBundle,
	type ScalableCliBundle,
	type ScalableSnapshotWarnings,
} from "@/server/providers/investment/scalable-cli";

const PROVIDER = "scalable";

/**
 * Stored on the depot when a snapshot could not be saved. Like every
 * `lastError` it is one or more complete sentences, rendered as it is.
 */
export const SCALABLE_INGEST_FAILED =
	"Der Abgleich konnte nicht gespeichert werden. Der letzte Bestand bleibt erhalten.";

export class ScalableIngestError extends Error {
	constructor(readonly code: ReturnType<typeof classifyInvestmentSyncFailure>) {
		super("Scalable-CLI-Abgleich fehlgeschlagen");
	}
}

/**
 * One sentence for what a successful sync still left out, or null. Depot and
 * cash were refreshed either way, so it says what is missing, not that the
 * sync failed.
 */
export function scalableSyncWarning(
	conflicts: number,
	warnings: ScalableSnapshotWarnings,
): string | null {
	const parts: string[] = [];
	const heldBack = conflicts + warnings.conflictingTransactions;
	if (heldBack)
		parts.push(
			`${heldBack} Brokerbuchung(en) mit widersprüchlicher Identität zurückgehalten`,
		);
	if (warnings.skippedTransactions)
		parts.push(
			`${warnings.skippedTransactions} Brokerbuchung(en) ohne Datum oder Kennung übersprungen`,
		);
	const holdings = warnings.skippedHoldings + warnings.duplicateHoldings;
	if (holdings)
		parts.push(
			`${holdings} Position(en) ohne gültige ISIN oder doppelt gemeldet übersprungen`,
		);
	if (warnings.reconciliation === "unreconciled")
		parts.push(
			"Depotwert von Scalable übernommen, obwohl er nicht aus Wertpapieren und Krypto aufgeht",
		);
	if (!parts.length) return null;
	return `${parts.join("; ")}. Depot und Guthaben wurden aktualisiert.`;
}

export async function ingestScalableCliSnapshot(
	userId: string,
	bundle: ScalableCliBundle,
) {
	const snapshot = parseScalableCliBundle(bundle);
	const sourceAccountId = `broker:${snapshot.portfolioId}`;
	const [account] = await db
		.insert(investmentSourceAccounts)
		.values({
			userId,
			provider: PROVIDER,
			sourceAccountId,
			method: "cli",
			currency: snapshot.currency,
			status: "pending",
			capabilities: snapshot.capabilities,
			lastAttemptedSyncAt: new Date(),
		})
		.onConflictDoUpdate({
			target: [
				investmentSourceAccounts.userId,
				investmentSourceAccounts.provider,
				investmentSourceAccounts.sourceAccountId,
			],
			set: { lastAttemptedSyncAt: new Date(), updatedAt: new Date() },
		})
		.returning();
	try {
		return await db.transaction(async (tx) => {
			await tx
				.select({ id: investmentSourceAccounts.id })
				.from(investmentSourceAccounts)
				.where(eq(investmentSourceAccounts.id, account.id))
				.for("update");
			const existing = await tx
				.select({
					id: investmentSourceTransactions.id,
					sourceId: investmentSourceTransactions.sourceId,
					fingerprint: investmentSourceTransactions.sourceFingerprint,
					occurredAt: investmentSourceTransactions.occurredAt,
					kind: investmentSourceTransactions.kind,
					status: investmentSourceTransactions.status,
					isin: investmentSourceTransactions.isin,
					currency: investmentSourceTransactions.currency,
					amountMinor: investmentSourceTransactions.amountMinor,
					encryptedRawMetadata:
						investmentSourceTransactions.encryptedRawMetadata,
				})
				.from(investmentSourceTransactions)
				.where(eq(investmentSourceTransactions.accountId, account.id));
			const known = new Map(existing.map((row) => [row.sourceId, row]));
			const newTransactions: typeof snapshot.transactions = [];
			let duplicates = 0;
			let revised = 0;
			let conflicts = 0;
			for (const row of snapshot.transactions) {
				const prior = known.get(row.sourceId);
				if (!prior) {
					newTransactions.push(row);
					continue;
				}
				const classification = classifyBrokerTransactionRevision(prior, row);
				if (classification === "duplicate") {
					duplicates++;
					continue;
				}
				if (classification === "identity_conflict") {
					conflicts++;
					continue;
				}
				await tx.insert(investmentSourceTransactionRevisions).values({
					userId,
					transactionId: prior.id,
					previousFingerprint: prior.fingerprint,
					previousOccurredAt: prior.occurredAt,
					previousStatus: prior.status,
					previousAmountMinor: prior.amountMinor,
					encryptedRawMetadata: prior.encryptedRawMetadata,
				});
				await tx
					.update(investmentSourceTransactions)
					.set({
						sourceFingerprint: row.fingerprint,
						occurredAt: row.occurredAt,
						kind: row.kind,
						status: row.status,
						instrumentName: row.instrumentName,
						isin: row.isin,
						quantity: row.quantity,
						amountMinor: row.amountMinor,
						currency: row.currency,
						encryptedRawMetadata: encryptSecret(JSON.stringify(row.raw)),
						updatedAt: new Date(),
					})
					.where(eq(investmentSourceTransactions.id, prior.id));
				revised++;
			}
			let imported = 0;
			for (let offset = 0; offset < newTransactions.length; offset += 100) {
				const inserted = await tx
					.insert(investmentSourceTransactions)
					.values(
						newTransactions.slice(offset, offset + 100).map((row) => ({
							userId,
							accountId: account.id,
							sourceId: row.sourceId,
							sourceFingerprint: row.fingerprint,
							occurredAt: row.occurredAt,
							kind: row.kind,
							status: row.status,
							instrumentName: row.instrumentName,
							isin: row.isin,
							quantity: row.quantity,
							amountMinor: row.amountMinor,
							currency: row.currency,
							encryptedRawMetadata: encryptSecret(JSON.stringify(row.raw)),
						})),
					)
					.onConflictDoNothing({
						target: [
							investmentSourceTransactions.accountId,
							investmentSourceTransactions.sourceId,
						],
					})
					.returning({ id: investmentSourceTransactions.id });
				imported += inserted.length;
			}
			duplicates += newTransactions.length - imported;
			for (const p of snapshot.positions) {
				const values = {
					userId,
					accountId: account.id,
					isin: p.isin,
					externalId: p.externalId,
					instrumentName: p.instrumentName,
					quantity: p.quantity,
					currency: p.currency,
					costBasisMinor: p.costBasisMinor,
					valueMinor: p.valueMinor,
					price: p.price,
					valuationAt: p.valuationAt,
					valuationSource: p.valuationSource,
					verification: p.confidence,
					assetClass: p.assetClass,
					encryptedRawMetadata: encryptSecret(JSON.stringify(p.raw)),
				};
				await tx
					.insert(investmentSourcePositions)
					.values(values)
					.onConflictDoUpdate({
						target: [
							investmentSourcePositions.accountId,
							investmentSourcePositions.isin,
						],
						set: { ...values, updatedAt: new Date() },
					});
			}
			const isins = snapshot.positions.map((p) => p.isin);
			await tx
				.delete(investmentSourcePositions)
				.where(
					and(
						eq(investmentSourcePositions.accountId, account.id),
						...(isins.length
							? [notInArray(investmentSourcePositions.isin, isins)]
							: []),
					),
				);
			const now = new Date();
			const warning = scalableSyncWarning(conflicts, snapshot.warnings);
			await tx
				.update(investmentSourceAccounts)
				.set({
					status: "active",
					method: "cli",
					currency: snapshot.currency,
					cashBalanceMinor: snapshot.cashBalanceMinor,
					cashValuationAt: snapshot.cashValuationAt,
					portfolioValueMinor: snapshot.portfolioValueMinor,
					cryptoValueMinor: snapshot.cryptoValueMinor,
					portfolioValuationAt: snapshot.portfolioValuationAt,
					lastAttemptedSyncAt: now,
					lastSuccessfulSyncAt: now,
					lastError: warning,
					capabilities: snapshot.capabilities,
					encryptedRawMetadata: encryptSecret(
						JSON.stringify({
							accountId: snapshot.accountId,
							portfolioId: snapshot.portfolioId,
						}),
					),
				})
				.where(eq(investmentSourceAccounts.id, account.id));
			logger.info("Scalable CLI snapshot accepted", {
				event: "scalable.cli.sync.completed",
				positions: snapshot.positions.length,
				imported,
				revised,
				conflicts,
				...snapshot.warnings,
			});
			return {
				positions: snapshot.positions.length,
				imported,
				duplicates,
				revised,
				conflicts,
				warning,
			};
		});
	} catch (error) {
		const errorCode = classifyInvestmentSyncFailure(error);
		await db
			.update(investmentSourceAccounts)
			.set({
				status: "error",
				lastError: SCALABLE_INGEST_FAILED,
			})
			.where(eq(investmentSourceAccounts.id, account.id));
		logger.warn("Scalable CLI snapshot rejected", {
			event: "scalable.cli.sync.failed",
			errorCode,
		});
		throw new ScalableIngestError(errorCode);
	}
}

export async function linkScalableAccount(
	userId: string,
	sourceAccountId: string,
	linkedAccountId: string | null,
) {
	if (linkedAccountId) {
		const target = await db.query.accounts.findFirst({
			where: and(eq(accounts.userId, userId), eq(accounts.id, linkedAccountId)),
		});
		if (!target) throw new Error("Fortuna-Konto nicht gefunden");
	}
	await db
		.update(investmentSourceAccounts)
		.set({ linkedAccountId })
		.where(
			and(
				eq(investmentSourceAccounts.userId, userId),
				eq(investmentSourceAccounts.id, sourceAccountId),
				eq(investmentSourceAccounts.provider, PROVIDER),
			),
		);
}

export async function investmentSourceStatus(userId: string) {
	const { all, selected, positions } = await selectedSourceAccounts(userId);
	const cashBalances = selected.map((a) => a.cashBalanceMinor);
	const portfolioValues = selected.map((a) => {
		if (a.portfolioValueMinor !== null) return a.portfolioValueMinor;
		const valued = positions.filter(
			(p) => p.accountId === a.id && p.valueMinor !== null,
		);
		return valued.length
			? valued.reduce((sum, p) => sum + (p.valueMinor ?? 0), 0)
			: null;
	});
	const lastSyncAt = selected.reduce<Date | null>(
		(last, a) =>
			!last || (a.lastSuccessfulSyncAt && a.lastSuccessfulSyncAt > last)
				? a.lastSuccessfulSyncAt
				: last,
		null,
	);
	const valuationAt = selected.reduce<Date | null>((last, a) => {
		const value =
			a.portfolioValuationAt ??
			a.cashValuationAt ??
			positions.find((p) => p.accountId === a.id)?.valuationAt ??
			null;
		return value && (!last || value < last) ? value : last;
	}, null);
	const transactionCounts = await Promise.all(
		selected.map(
			async (a) =>
				(
					await db
						.select({ total: count() })
						.from(investmentSourceTransactions)
						.where(eq(investmentSourceTransactions.accountId, a.id))
				)[0].total,
		),
	);
	return {
		status: selected[0]?.status ?? "disconnected",
		method: selected[0]?.method ?? "none",
		lastSyncAt,
		lastAttemptedSyncAt: selected.reduce<Date | null>(
			(last, a) =>
				!last || (a.lastAttemptedSyncAt && a.lastAttemptedSyncAt > last)
					? a.lastAttemptedSyncAt
					: last,
			null,
		),
		lastError: selected.find((a) => a.lastError)?.lastError ?? null,
		cashBalanceMinor:
			cashBalances.length &&
			cashBalances.every((v) => v !== null) &&
			selected.every((a) => a.currency === "EUR")
				? cashBalances.reduce<number>((sum, v) => sum + (v ?? 0), 0)
				: null,
		portfolioValueMinor:
			portfolioValues.length &&
			portfolioValues.every((value) => value !== null) &&
			selected.every((a) => a.currency === "EUR")
				? portfolioValues.reduce<number>((sum, value) => sum + (value ?? 0), 0)
				: null,
		positionCount: positions.filter((p) =>
			selected.some((a) => a.id === p.accountId),
		).length,
		transactionCount: transactionCounts.reduce((sum, value) => sum + value, 0),
		currency: selected[0]?.currency ?? "EUR",
		valuationAt,
		stale: !valuationAt || Date.now() - valuationAt.getTime() > 30 * 86400_000,
		capabilities: selected.flatMap((a) => a.capabilities ?? []),
		accounts: all.map((a) => ({
			id: a.id,
			method: a.method,
			status: a.status,
			label: `Broker-Portfolio ···${a.sourceAccountId.slice(-4)}`,
			linkedAccountId: a.linkedAccountId,
			lastSyncAt: a.lastSuccessfulSyncAt,
		})),
	};
}

async function selectedSourceAccounts(userId: string) {
	const [all, positions] = await Promise.all([
		db
			.select()
			.from(investmentSourceAccounts)
			.where(
				and(
					eq(investmentSourceAccounts.userId, userId),
					eq(investmentSourceAccounts.provider, PROVIDER),
				),
			),
		db
			.select()
			.from(investmentSourcePositions)
			.where(eq(investmentSourcePositions.userId, userId)),
	]);
	const selected = preferredSourceAccounts(
		all,
		(id) => positions.some((p) => p.accountId === id && p.valueMinor !== null),
		(id) => positions.some((p) => p.accountId === id),
	);
	return { all, selected, positions };
}

/** Account-facing broker summaries. These are views of source accounts, not new Fortuna balances. */
export async function listInvestmentSourceAccounts(userId: string) {
	const { selected, positions } = await selectedSourceAccounts(userId);
	if (!selected.length) return [];
	const transactionCounts = await db
		.select({
			accountId: investmentSourceTransactions.accountId,
			total: count(),
		})
		.from(investmentSourceTransactions)
		.where(
			and(
				eq(investmentSourceTransactions.userId, userId),
				inArray(
					investmentSourceTransactions.accountId,
					selected.map((account) => account.id),
				),
			),
		)
		.groupBy(investmentSourceTransactions.accountId);
	const counts = new Map(
		transactionCounts.map((row) => [row.accountId, row.total]),
	);
	return selected.map((account) => {
		const holdings = positions.filter(
			(position) => position.accountId === account.id,
		);
		const valued = holdings.filter((position) => position.valueMinor !== null);
		const portfolioValueMinor =
			account.portfolioValueMinor ??
			(valued.length
				? valued.reduce((sum, position) => sum + (position.valueMinor ?? 0), 0)
				: null);
		const valuationAt =
			account.portfolioValuationAt ??
			holdings.reduce<Date | null>(
				(oldest, position) =>
					position.valuationAt && (!oldest || position.valuationAt < oldest)
						? position.valuationAt
						: oldest,
				null,
			);
		return {
			id: account.id,
			provider: account.provider,
			label: `Scalable-Depot ···${account.sourceAccountId.slice(-4)}`,
			method: account.method,
			status: account.status,
			currency: account.currency,
			portfolioValueMinor,
			cryptoValueMinor: account.cryptoValueMinor,
			cashBalanceMinor: account.cashBalanceMinor,
			positionCount: holdings.length,
			unvaluedPositionCount: holdings.length - valued.length,
			transactionCount: counts.get(account.id) ?? 0,
			valuationAt,
			cashValuationAt: account.cashValuationAt,
			lastSyncAt: account.lastSuccessfulSyncAt,
			lastError: account.lastError,
			linkedAccountId: account.linkedAccountId,
		};
	});
}

export async function getInvestmentSourceAccount(
	userId: string,
	id: string,
	input: { offset: number; limit: number },
) {
	const account = (await listInvestmentSourceAccounts(userId)).find(
		(row) => row.id === id,
	);
	if (!account)
		throw new ORPCError("NOT_FOUND", { message: "Depot nicht gefunden" });
	const [positions, transactions] = await Promise.all([
		listInvestmentSourcePositions(userId),
		listInvestmentSourceTransactions(userId, { accountId: id, ...input }),
	]);
	return {
		account,
		positions: positions.filter((position) => position.accountId === id),
		transactions,
		transactionCount: account.transactionCount,
		offset: input.offset,
		limit: input.limit,
	};
}

export async function listInvestmentSourcePositions(userId: string) {
	const { selected } = await selectedSourceAccounts(userId);
	if (!selected.length) return [];
	return db
		.select({
			id: investmentSourcePositions.id,
			accountId: investmentSourcePositions.accountId,
			isin: investmentSourcePositions.isin,
			instrumentName: investmentSourcePositions.instrumentName,
			quantity: investmentSourcePositions.quantity,
			costBasisMinor: investmentSourcePositions.costBasisMinor,
			currency: investmentSourcePositions.currency,
			valueMinor: investmentSourcePositions.valueMinor,
			verification: investmentSourcePositions.verification,
			wkn: investmentSourcePositions.wkn,
			ticker: investmentSourcePositions.ticker,
			assetClass: investmentSourcePositions.assetClass,
			price: investmentSourcePositions.price,
			valuationAt: investmentSourcePositions.valuationAt,
			valuationSource: investmentSourcePositions.valuationSource,
			externalId: investmentSourcePositions.externalId,
			method: investmentSourceAccounts.method,
		})
		.from(investmentSourcePositions)
		.innerJoin(
			investmentSourceAccounts,
			eq(investmentSourcePositions.accountId, investmentSourceAccounts.id),
		)
		.where(
			and(
				eq(investmentSourcePositions.userId, userId),
				inArray(
					investmentSourcePositions.accountId,
					selected.map((a) => a.id),
				),
			),
		);
}

type SourceTransactionFilter = {
	accountId?: string;
	from?: string;
	to?: string;
	limit?: number;
	offset?: number;
	direction?: "inflow" | "outflow";
};

function sourceTransactionWhere(
	userId: string,
	accountIds: string[],
	filter: SourceTransactionFilter,
) {
	return and(
		eq(investmentSourceTransactions.userId, userId),
		inArray(investmentSourceTransactions.accountId, accountIds),
		filter.from
			? gte(
					investmentSourceTransactions.occurredAt,
					new Date(`${filter.from}T00:00:00Z`),
				)
			: undefined,
		filter.to
			? lte(
					investmentSourceTransactions.occurredAt,
					new Date(`${filter.to}T23:59:59Z`),
				)
			: undefined,
		filter.direction === "inflow"
			? gte(investmentSourceTransactions.amountMinor, 0)
			: undefined,
		filter.direction === "outflow"
			? lte(investmentSourceTransactions.amountMinor, -1)
			: undefined,
	);
}

export async function listInvestmentSourceTransactions(
	userId: string,
	filter: SourceTransactionFilter = {},
) {
	const { selected } = await selectedSourceAccounts(userId);
	const matching = filter.accountId
		? selected.filter((account) => account.id === filter.accountId)
		: selected;
	if (!matching.length) return [];
	const where = sourceTransactionWhere(
		userId,
		matching.map((account) => account.id),
		filter,
	);
	return db
		.select({
			id: investmentSourceTransactions.id,
			accountId: investmentSourceTransactions.accountId,
			sourceId: investmentSourceTransactions.sourceId,
			occurredAt: investmentSourceTransactions.occurredAt,
			kind: investmentSourceTransactions.kind,
			status: investmentSourceTransactions.status,
			instrumentName: investmentSourceTransactions.instrumentName,
			isin: investmentSourceTransactions.isin,
			quantity: investmentSourceTransactions.quantity,
			amountMinor: investmentSourceTransactions.amountMinor,
			feeMinor: investmentSourceTransactions.feeMinor,
			taxMinor: investmentSourceTransactions.taxMinor,
			currency: investmentSourceTransactions.currency,
		})
		.from(investmentSourceTransactions)
		.innerJoin(
			investmentSourceAccounts,
			eq(investmentSourceTransactions.accountId, investmentSourceAccounts.id),
		)
		.where(where)
		.orderBy(desc(investmentSourceTransactions.occurredAt))
		.limit(Math.min(filter.limit ?? 100, 200))
		.offset(Math.min(filter.offset ?? 0, 100_000));
}

export async function listInvestmentSourceTransactionPage(
	userId: string,
	filter: SourceTransactionFilter = {},
) {
	const { selected } = await selectedSourceAccounts(userId);
	const matching = filter.accountId
		? selected.filter((account) => account.id === filter.accountId)
		: selected;
	if (!matching.length) return { rows: [], total: 0 };
	const [rows, [aggregate]] = await Promise.all([
		listInvestmentSourceTransactions(userId, filter),
		db
			.select({ total: count() })
			.from(investmentSourceTransactions)
			.where(
				sourceTransactionWhere(
					userId,
					matching.map((account) => account.id),
					filter,
				),
			),
	]);
	return { rows, total: aggregate.total };
}

export async function disconnectInvestmentSource(userId: string) {
	await db
		.update(investmentSourceAccounts)
		.set({ status: "disconnected" })
		.where(
			and(
				eq(investmentSourceAccounts.userId, userId),
				eq(investmentSourceAccounts.provider, PROVIDER),
			),
		);
}
