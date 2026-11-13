import { createHash } from "node:crypto";
import { pool } from "@/server/db";

/** A per-user, session-level PostgreSQL advisory lock for Copilot operations. */
export class CopilotOperationBusyError extends Error {
	constructor() {
		super("A Copilot operation is already running for this user");
		this.name = "CopilotOperationBusyError";
	}
}

function lockKey(userId: string): string {
	// PostgreSQL's bigint advisory-lock namespace is shared with the whole DB.
	// Hash a domain-separated value so this feature has a stable, private key.
	return createHash("sha256")
		.update(`fortuna:copilot:user:${userId}`)
		.digest()
		.readBigInt64BE(0)
		.toString();
}

export async function withCopilotOperationLock<T>(
	userId: string,
	operation: () => Promise<T>,
): Promise<T> {
	const client = await pool.connect();
	let acquired = false;
	let destroyed = false;
	const key = lockKey(userId);
	try {
		const result = await client.query<{ acquired: boolean }>(
			"SELECT pg_try_advisory_lock($1::bigint) AS acquired",
			[key],
		);
		acquired = result.rows[0]?.acquired === true;
		if (!acquired) throw new CopilotOperationBusyError();
		return await operation();
	} finally {
		try {
			if (acquired) {
				try {
					await client.query("SELECT pg_advisory_unlock($1::bigint)", [key]);
				} catch (error) {
					// Never return a possibly still-locked session to the pool.
					client.release(
						error instanceof Error ? error : new Error("Unlock failed"),
					);
					destroyed = true;
				}
			}
		} finally {
			if (!destroyed) client.release();
		}
	}
}
