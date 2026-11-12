import { ORPCError } from "@orpc/server";
import { and, eq, sql } from "drizzle-orm";
import { bankSyncLockPool, db } from "@/server/db";
import { bankConnections } from "@/server/db/schema";

export type BankSyncFence = {
	userId: string;
	connectionId: string;
	epoch: bigint;
	signal: AbortSignal;
};

export type BankSyncTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class BankSyncFenceLostError extends Error {
	constructor() {
		super("Bank connection sync fence was lost");
		this.name = "BankSyncFenceLostError";
	}
}

/**
 * Check the fencing epoch and hold the connection row for the whole write
 * transaction. The next holder's epoch increment must wait for this transaction
 * to finish; after it commits, stale holders cannot begin another write.
 */
export async function withBankSyncFenceTransaction<T>(
	fence: BankSyncFence,
	run: (tx: BankSyncTx) => Promise<T>,
): Promise<T> {
	if (fence.signal.aborted) throw new BankSyncFenceLostError();
	return db.transaction(async (tx) => {
		const [connection] = await tx
			.select({ epoch: bankConnections.syncEpoch })
			.from(bankConnections)
			.where(
				and(
					eq(bankConnections.id, fence.connectionId),
					eq(bankConnections.userId, fence.userId),
				),
			)
			.for("share");
		if (!connection || connection.epoch !== fence.epoch || fence.signal.aborted)
			throw new BankSyncFenceLostError();
		return run(tx);
	});
}

/** Fence a user-wide bank-data mutation that does not belong to one sync. */
export async function withUserBankSyncFenceTransaction<T>(
	userId: string,
	run: (tx: BankSyncTx) => Promise<T>,
): Promise<T> {
	return db.transaction(async (tx) => {
		await tx
			.update(bankConnections)
			.set({
				syncEpoch: sql`${bankConnections.syncEpoch} + 1`,
				updatedAt: sql`${bankConnections.updatedAt}`,
			})
			.where(eq(bankConnections.userId, userId));
		return run(tx);
	});
}

/**
 * One bank sync per connection at a time, whoever starts it.
 *
 * The owner's Abgleichen, the automatic sync on page load and the first read
 * inside the bank callback all read the same session and write the same
 * accounts. Run side by side they insert the same new account twice and spend
 * the bank's read allowance twice. Every caller goes through here: a second
 * caller in this process joins the read already running. PostgreSQL's
 * connection-scoped lock handles requests served by other replicas.
 */
const activeSyncs = new Map<string, Promise<unknown>>();

function key(userId: string, connectionId: string) {
	return `${userId}:${connectionId}`;
}

export function isSyncing(userId: string, connectionId: string): boolean {
	return activeSyncs.has(key(userId, connectionId));
}

export function coalesceSync<T>(
	userId: string,
	connectionId: string,
	run: () => Promise<T>,
): Promise<T> {
	const syncKey = key(userId, connectionId);
	const active = activeSyncs.get(syncKey);
	if (active) return active as Promise<T>;
	const task = run().finally(() => {
		activeSyncs.delete(syncKey);
	});
	activeSyncs.set(syncKey, task);
	return task;
}
/**
 * Cross-process exclusion for a bank connection. The session lock lives on a
 * dedicated PostgreSQL connection for the complete operation, including bank
 * HTTP calls. PostgreSQL drops it if the process or socket dies. Never use a
 * transaction lock here: a bank read can outlive a transaction timeout.
 */
export async function withBankConnectionLock<T>(
	userId: string,
	connectionId: string,
	run: (fence: BankSyncFence) => Promise<T>,
): Promise<T> {
	const client = await bankSyncLockPool.connect();
	let acquired = false;
	let connectionError: Error | null = null;
	let operationError: unknown;
	let result: T | undefined;
	const controller = new AbortController();
	const lockName = `fortuna:bank-sync:${userId}:${connectionId}`;
	const onConnectionError = (error: Error) => {
		connectionError = error;
		controller.abort(error);
	};
	client.on("error", onConnectionError);
	try {
		const lockResult = await client.query<{ acquired: boolean }>(
			"select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired",
			[lockName],
		);
		acquired = lockResult.rows[0]?.acquired === true;
		if (!acquired)
			throw new ORPCError("CONFLICT", {
				message: "Ein Abgleich läuft gerade. Bitte kurz warten.",
			});
		const [connection] = await db
			.update(bankConnections)
			.set({
				syncEpoch: sql`${bankConnections.syncEpoch} + 1`,
				// Taking a coordination lock is not a domain update and must not
				// reset the one-hour retry delay for an errored connection.
				updatedAt: sql`${bankConnections.updatedAt}`,
			})
			.where(
				and(
					eq(bankConnections.id, connectionId),
					eq(bankConnections.userId, userId),
				),
			)
			.returning({ epoch: bankConnections.syncEpoch });
		if (!connection)
			throw new ORPCError("NOT_FOUND", {
				message: "Bankverbindung nicht gefunden",
			});
		const fence: BankSyncFence = {
			userId,
			connectionId,
			epoch: connection.epoch,
			signal: controller.signal,
		};
		result = await run(fence);
	} catch (error) {
		operationError = error;
		if (
			!acquired &&
			(!(error instanceof ORPCError) || error.code !== "CONFLICT")
		)
			connectionError =
				error instanceof Error ? error : new Error("Lock acquisition failed");
	}
	if (acquired && !connectionError) {
		try {
			const unlocked = await client.query<{ pg_advisory_unlock: boolean }>(
				"select pg_advisory_unlock(hashtextextended($1, 0))",
				[lockName],
			);
			if (!unlocked.rows[0]?.pg_advisory_unlock)
				connectionError = new Error("Bank sync lock was not held at release");
		} catch (error) {
			connectionError =
				error instanceof Error ? error : new Error("Lock release failed");
		}
	}
	client.removeListener("error", onConnectionError);
	client.release(Boolean(connectionError));
	if (connectionError)
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "Die Bankabstimmung wurde wegen eines Datenbankfehlers beendet.",
		});
	if (operationError) throw operationError;
	return result as T;
}

/** Recheck the automatic-sync decision only after acquiring the replica lock. */
export async function withAutomaticBankSyncLock<T>(
	userId: string,
	connectionId: string,
	stillDue: (fence: BankSyncFence) => Promise<boolean>,
	run: (fence: BankSyncFence) => Promise<T>,
): Promise<T | null> {
	return withBankConnectionLock(userId, connectionId, async (fence) => {
		if (!(await stillDue(fence))) return null;
		return run(fence);
	});
}
