import { ORPCError } from "@orpc/server";
import { and, desc, eq, isNotNull, lte, ne } from "drizzle-orm";
import { db } from "@/server/db";
import {
	accounts,
	type BankConnection,
	bankConnections,
} from "@/server/db/schema";
import { logger } from "@/server/logger";
import { EnableBankingApiError } from "@/server/providers/bank/enable-banking-client";
import type { PsuPresence } from "@/server/providers/bank/psu-presence";
import {
	ENABLE_BANKING_RATE_LIMIT_RETRY_MS,
	EnableBankingSyncError,
	hasEnableBankingAccounts,
	hasEnableBankingSession,
	syncEnableBankingConnection,
} from "./enable-banking";
import type { BankSyncFence } from "./sync-coalescing";
import {
	coalesceSync,
	isSyncing,
	withAutomaticBankSyncLock,
	withBankConnectionLock,
	withBankSyncFenceTransaction,
} from "./sync-coalescing";

export type ConnectionRow = Omit<
	BankConnection,
	"encryptedSecret" | "providerConnectionId"
> & {
	accountCount: number;
	canSync: boolean;
};

// Nothing but the owner's own browser starts a sync, so a read carrying PSU
// presence headers is one the bank may serve without limit and Fortuna can
// refresh often. A bank that rejects those headers counts every read against
// four a day, so that case is paced to last a day instead.
export const PRESENT_SYNC_INTERVAL_MS = 5 * 60 * 1_000;
export const UNATTENDED_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1_000;
export const AUTOMATIC_SYNC_ERROR_RETRY_MS = 60 * 60 * 1_000;
export const AUTOMATIC_SYNC_RATE_LIMIT_RETRY_MS =
	ENABLE_BANKING_RATE_LIMIT_RETRY_MS;

type SyncResult = {
	accountsLinked: number;
	imported: number;
	duplicates: number;
};

function assertNotSyncing(userId: string, id: string) {
	if (isSyncing(userId, id))
		throw new ORPCError("CONFLICT", {
			message: "Ein Abgleich läuft gerade. Bitte kurz warten.",
		});
}

export function isAutomaticSyncDue(
	connection: Pick<
		BankConnection,
		| "status"
		| "encryptedSecret"
		| "consentExpiresAt"
		| "lastSyncAt"
		| "automaticRetryAt"
		| "updatedAt"
	>,
	now = new Date(),
	intervalMs = UNATTENDED_SYNC_INTERVAL_MS,
) {
	if (!connection.encryptedSecret) return false;
	if (connection.status !== "active" && connection.status !== "error")
		return false;
	if (connection.consentExpiresAt && connection.consentExpiresAt <= now)
		return false;
	if (connection.automaticRetryAt && connection.automaticRetryAt > now)
		return false;
	// An authorization that never came back from the bank holds state but no
	// session, and the sync refuses it. As an error row it was picked again on
	// every page load once the hour had passed, and failed every time.
	if (!hasEnableBankingSession(connection.encryptedSecret)) return false;
	// A consent the bank granted without accounts cannot gain one: the account
	// list is fixed when the bank grants it. Re-reading the session on every
	// page load only spends the provider's patience.
	if (!hasEnableBankingAccounts(connection.encryptedSecret)) return false;
	if (
		connection.status === "error" &&
		now.getTime() - connection.updatedAt.getTime() <
			AUTOMATIC_SYNC_ERROR_RETRY_MS
	)
		return false;
	return (
		!connection.lastSyncAt ||
		now.getTime() - connection.lastSyncAt.getTime() >= intervalMs
	);
}

export function automaticSyncInterval(
	connection: Pick<BankConnection, "presenceHeadersRateLimited">,
	presence: PsuPresence | null,
): number {
	// This capability observation survives cooldown expiry and successful reads,
	// and is shared by every replica. `automaticRetryAt` remains a cooldown.
	return presence && !connection.presenceHeadersRateLimited
		? PRESENT_SYNC_INTERVAL_MS
		: UNATTENDED_SYNC_INTERVAL_MS;
}

function publicRow(c: BankConnection, accountCount: number): ConnectionRow {
	// Neither the stored secret nor the provider's own connection identifier
	// belongs in an API response.
	const {
		encryptedSecret: _secret,
		providerConnectionId: _providerConnectionId,
		...rest
	} = c;
	return {
		...rest,
		accountCount,
		canSync:
			c.status !== "pending" &&
			c.status !== "disconnected" &&
			c.status !== "expired" &&
			Boolean(c.encryptedSecret) &&
			(!c.consentExpiresAt || c.consentExpiresAt > new Date()) &&
			(c.provider !== "enable-banking" ||
				hasEnableBankingSession(c.encryptedSecret)),
	};
}

export async function listConnections(
	userId: string,
): Promise<ConnectionRow[]> {
	const rows = await db
		.select()
		.from(bankConnections)
		.where(eq(bankConnections.userId, userId))
		.orderBy(desc(bankConnections.createdAt));
	const accs = await db
		.select({ connectionId: accounts.bankConnectionId })
		.from(accounts)
		.where(eq(accounts.userId, userId));
	const counts = new Map<string, number>();
	for (const a of accs)
		if (a.connectionId)
			counts.set(a.connectionId, (counts.get(a.connectionId) ?? 0) + 1);
	return rows.map((r) => publicRow(r, counts.get(r.id) ?? 0));
}

// A connection that never linked an account holds no history worth keeping, so
// disconnecting it removes the row instead of leaving an inert entry behind.
export async function disconnect(
	userId: string,
	id: string,
): Promise<{ removed: boolean }> {
	assertNotSyncing(userId, id);
	return withBankConnectionLock(userId, id, (fence) =>
		withBankSyncFenceTransaction(fence, async (tx) => {
			const [row] = await tx
				.update(bankConnections)
				.set({
					status: "disconnected",
					encryptedSecret: null,
					automaticRetryAt: null,
					lastError: null,
				})
				.where(
					and(eq(bankConnections.id, id), eq(bankConnections.userId, userId)),
				)
				.returning();
			if (!row)
				throw new ORPCError("NOT_FOUND", {
					message: "Verbindung nicht gefunden",
				});
			const linked = await tx
				.select({ id: accounts.id })
				.from(accounts)
				.where(
					and(eq(accounts.userId, userId), eq(accounts.bankConnectionId, id)),
				);
			if (linked.length === 0) {
				await tx.delete(bankConnections).where(eq(bankConnections.id, id));
				logger.info("Bank connection removed", {
					event: "connection.removed",
					provider: row.provider,
					accountsDetached: 0,
				});
				return { removed: true };
			}
			await tx
				.update(accounts)
				.set({ syncStatus: "disconnected" })
				.where(eq(accounts.bankConnectionId, id));
			return { removed: false };
		}),
	);
}

// Removing keeps accounts and transactions but unlinks them from the provider,
// so the entry disappears from the list for good.
export async function removeConnection(
	userId: string,
	id: string,
): Promise<{ accountsDetached: number }> {
	assertNotSyncing(userId, id);
	return withBankConnectionLock(userId, id, (fence) =>
		withBankSyncFenceTransaction(fence, async (tx) => {
			const row = await tx.query.bankConnections.findFirst({
				where: and(
					eq(bankConnections.id, id),
					eq(bankConnections.userId, userId),
				),
			});
			if (!row)
				throw new ORPCError("NOT_FOUND", {
					message: "Verbindung nicht gefunden",
				});
			const detached = await tx
				.update(accounts)
				.set({
					bankConnectionId: null,
					providerAccountId: null,
					syncStatus: "manual",
				})
				.where(
					and(eq(accounts.userId, userId), eq(accounts.bankConnectionId, id)),
				)
				.returning({ id: accounts.id });
			await tx.delete(bankConnections).where(eq(bankConnections.id, id));
			logger.info("Bank connection removed", {
				event: "connection.removed",
				provider: row.provider,
				accountsDetached: detached.length,
			});
			return { accountsDetached: detached.length };
		}),
	);
}

export async function syncConnection(
	userId: string,
	id: string,
	presence: PsuPresence | null = null,
): Promise<SyncResult> {
	return coalesceSync(userId, id, () =>
		withBankConnectionLock(userId, id, (fence) =>
			runConnectionSync(userId, id, fence, presence),
		),
	);
}

async function runConnectionSync(
	userId: string,
	id: string,
	fence: BankSyncFence,
	presence: PsuPresence | null = null,
): Promise<SyncResult> {
	const connection = await db.query.bankConnections.findFirst({
		where: and(eq(bankConnections.id, id), eq(bankConnections.userId, userId)),
	});
	if (!connection)
		throw new ORPCError("NOT_FOUND", { message: "Verbindung nicht gefunden" });
	if (!connection.encryptedSecret || connection.status === "disconnected")
		throw new ORPCError("BAD_REQUEST", {
			message: "Die Verbindung ist nicht aktiv",
		});
	if (connection.consentExpiresAt && connection.consentExpiresAt <= new Date())
		throw new ORPCError("BAD_REQUEST", {
			message: "Bankfreigabe abgelaufen. Bitte verbinde die Bank erneut.",
		});
	if (connection.provider === "enable-banking") {
		if (!hasEnableBankingSession(connection.encryptedSecret))
			throw new ORPCError("BAD_REQUEST", {
				message:
					"Bankfreigabe in Fortuna noch nicht abgeschlossen. Beende die Bankanmeldung oder verbinde die Bank erneut.",
			});
		if (connection.automaticRetryAt && connection.automaticRetryAt > new Date())
			throw new ORPCError("TOO_MANY_REQUESTS", {
				message:
					"Banklimit aktiv. Der nächste Versuch ist nach der angezeigten Wartezeit möglich.",
			});
		try {
			return await syncEnableBankingConnection(userId, id, fence, presence);
		} catch (err) {
			const failure = err instanceof EnableBankingSyncError ? err.cause : err;
			logger.warn("Enable Banking sync failed", {
				event: "connection.sync.failed",
				provider: "enable-banking",
				stage: err instanceof EnableBankingSyncError ? err.stage : "unknown",
				errorClass:
					failure instanceof EnableBankingApiError
						? "provider_http"
						: failure instanceof Error && failure.name === "TimeoutError"
							? "timeout"
							: "other",
				errorName: failure instanceof Error ? failure.name : typeof failure,
				errorCode:
					failure &&
					typeof failure === "object" &&
					"code" in failure &&
					typeof failure.code === "string" &&
					/^[A-Z0-9_]{2,32}$/.test(failure.code)
						? failure.code
						: undefined,
				providerStatus:
					failure instanceof EnableBankingApiError ? failure.status : undefined,
				providerCode:
					failure instanceof EnableBankingApiError
						? failure.providerCode
						: undefined,
				operation:
					failure instanceof EnableBankingApiError
						? failure.operation
						: undefined,
			});
			const rateLimited =
				failure instanceof EnableBankingApiError && failure.status === 429;
			const message = rateLimited
				? "Banklimit erreicht (HTTP 429). Bis zum nächsten Versuch bleiben die letzten Kontostände erhalten."
				: failure instanceof EnableBankingApiError
					? `Bankabgleich fehlgeschlagen (HTTP ${failure.status}).`
					: "Bankabgleich fehlgeschlagen.";
			await withBankSyncFenceTransaction(fence, (tx) =>
				tx
					.update(bankConnections)
					.set({
						status: "error",
						lastError: message,
						automaticRetryAt: rateLimited
							? new Date(Date.now() + AUTOMATIC_SYNC_RATE_LIMIT_RETRY_MS)
							: null,
						...(rateLimited && presence
							? { presenceHeadersRateLimited: true }
							: {}),
					})
					.where(eq(bankConnections.id, id)),
			);
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message:
					"Abgleich fehlgeschlagen; vorhandene Daten bleiben unverändert",
			});
		}
	}
	// Enable Banking is the only bank adapter; anything else is a legacy row.
	throw new ORPCError("BAD_REQUEST", {
		message: "Für diesen Anbieter gibt es keinen Adapter mehr",
	});
}

export async function syncDueConnections(
	userId: string,
	now = new Date(),
	presence: PsuPresence | null = null,
) {
	const connections = await db
		.select()
		.from(bankConnections)
		.where(eq(bankConnections.userId, userId));
	const expired = connections.filter(
		(connection) =>
			connection.encryptedSecret &&
			connection.status !== "disconnected" &&
			connection.consentExpiresAt &&
			connection.consentExpiresAt <= now,
	);
	const expiredResults = await Promise.allSettled(
		expired.map((connection) =>
			withBankConnectionLock(userId, connection.id, (fence) =>
				withBankSyncFenceTransaction(fence, async (tx) => {
					const current = await tx.query.bankConnections.findFirst({
						where: and(
							eq(bankConnections.id, connection.id),
							eq(bankConnections.userId, userId),
						),
					});
					if (
						!current?.encryptedSecret ||
						current.status === "disconnected" ||
						!current.consentExpiresAt ||
						current.consentExpiresAt > now
					)
						return false;
					await tx
						.update(bankConnections)
						.set({
							status: "expired",
							lastError: "Bankfreigabe abgelaufen. Bitte erneut verbinden.",
						})
						.where(
							and(
								eq(bankConnections.id, connection.id),
								eq(bankConnections.userId, userId),
								ne(bankConnections.status, "disconnected"),
								isNotNull(bankConnections.encryptedSecret),
								lte(bankConnections.consentExpiresAt, now),
							),
						);
					return true;
				}),
			),
		),
	);
	const expiredCount = expiredResults.filter(
		(result) => result.status === "fulfilled" && result.value,
	).length;
	const due = connections.filter((connection) =>
		isAutomaticSyncDue(
			connection,
			now,
			automaticSyncInterval(connection, presence),
		),
	);
	const settled = await Promise.allSettled(
		due.map((connection) =>
			coalesceSync(userId, connection.id, () =>
				withAutomaticBankSyncLock(
					userId,
					connection.id,
					async (fence) => {
						return withBankSyncFenceTransaction(fence, async (tx) => {
							const current = await tx.query.bankConnections.findFirst({
								where: and(
									eq(bankConnections.id, connection.id),
									eq(bankConnections.userId, userId),
								),
							});
							return (
								current !== undefined &&
								isAutomaticSyncDue(
									current,
									new Date(),
									automaticSyncInterval(current, presence),
								)
							);
						});
					},
					(fence) => runConnectionSync(userId, connection.id, fence, presence),
				),
			),
		),
	);
	const result = settled.reduce(
		(summary, entry) => {
			if (entry.status === "rejected") {
				summary.attempted += 1;
				summary.failed += 1;
				return summary;
			}
			if (entry.value === null) return summary;
			summary.attempted += 1;
			summary.succeeded += 1;
			summary.accountsLinked += entry.value.accountsLinked;
			summary.imported += entry.value.imported;
			summary.duplicates += entry.value.duplicates;
			return summary;
		},
		{
			attempted: 0,
			succeeded: 0,
			failed: 0,
			expired: expiredCount,
			accountsLinked: 0,
			imported: 0,
			duplicates: 0,
		},
	);
	logger.info("Automatic bank sync completed", {
		event: "connection.auto_sync.completed",
		...result,
	});
	return result;
}
