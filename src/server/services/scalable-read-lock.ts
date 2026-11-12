import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";

declare global {
	// eslint-disable-next-line no-var
	var __fortunaScalableReadLockPool: Pool | undefined;
}

const lockPool =
	globalThis.__fortunaScalableReadLockPool ??
	new Pool({
		connectionString: process.env.DATABASE_URL,
		max: 2,
		allowExitOnIdle: true,
	});
if (process.env.NODE_ENV !== "production")
	globalThis.__fortunaScalableReadLockPool = lockPool;

export function scalableReadLockKey(userId: string): string {
	return createHash("sha256")
		.update(`fortuna:scalable-read-session:user:${userId}`)
		.digest()
		.readBigInt64BE(0)
		.toString();
}

export class ScalableReadLockLostError extends Error {
	constructor() {
		super("Scalable read lock was lost");
		this.name = "ScalableReadLockLostError";
	}
}

export type ScalableReadClaim = {
	connectionId: string;
	encryptedSecret: string;
	generation: number;
};

export type ScalableReadLockContext = {
	client: PoolClient;
	assertHeld: () => Promise<void>;
};

/** Increment and return the durable fencing generation on the lock session. */
export async function claimScalableReadOperation(
	userId: string,
	lock: ScalableReadLockContext,
): Promise<ScalableReadClaim | null> {
	await lock.assertHeld();
	const result = await lock.client.query<{
		id: string;
		encryptedSecret: string;
		generation: number;
	}>(
		`UPDATE external_connections
SET scalable_read_generation = scalable_read_generation + 1,
    updated_at = now()
WHERE user_id = $1
  AND provider = 'scalable_hosted_cli'
  AND status IN ('active', 'error')
  AND encrypted_secret IS NOT NULL
RETURNING id, encrypted_secret AS "encryptedSecret",
          scalable_read_generation AS generation`,
		[userId],
	);
	const row = result.rows[0];
	return row
		? {
				connectionId: row.id,
				encryptedSecret: row.encryptedSecret,
				generation: row.generation,
			}
		: null;
}

/** Serialize read-only Scalable CLI workspaces across all application replicas. */
export async function withScalableReadSessionLock<T>(
	userId: string,
	operation: (lock: ScalableReadLockContext) => Promise<T>,
): Promise<T> {
	const client = await lockPool.connect();
	let acquired = false;
	let destroyed = false;
	const key = scalableReadLockKey(userId);
	const assertHeld = async () => {
		const held = await client.query<{ held: boolean }>(
			`SELECT EXISTS (
  SELECT 1 FROM pg_locks
  WHERE locktype = 'advisory'
    AND pid = pg_backend_pid()
    AND granted
    AND objsubid = 1
    AND classid::bigint = (($1::bigint >> 32) & 4294967295)
    AND objid::bigint = ($1::bigint & 4294967295)
) AS held`,
			[key],
		);
		if (held.rows[0]?.held !== true) throw new ScalableReadLockLostError();
	};
	try {
		await client.query("select pg_advisory_lock($1::bigint)", [key]);
		acquired = true;
		return await operation({
			assertHeld,
			client,
		});
	} finally {
		try {
			if (acquired)
				await client.query("select pg_advisory_unlock($1::bigint)", [key]);
		} catch (error) {
			client.release(
				error instanceof Error ? error : new Error("Unlock failed"),
			);
			destroyed = true;
		} finally {
			if (!destroyed) client.release();
		}
	}
}
