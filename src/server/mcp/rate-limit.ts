import { createHash } from "node:crypto";
import { pool } from "@/server/db";

const WINDOW_MS = 60_000;
const LIMIT = 120;
let nextCleanup = 0;

/** Atomic counters are shared by every web replica. Raw IPs and tokens are not stored. */
export async function enforceMcpRateLimit(key: string): Promise<number | null> {
	if (Date.now() >= nextCleanup) {
		nextCleanup = Date.now() + 5 * 60_000;
		await pool.query(
			"delete from mcp_rate_limit where reset_at < floor(extract(epoch from clock_timestamp()) * 1000)::bigint - 3600000",
		);
	}
	const keyHash = createHash("sha256").update(key).digest("hex");
	const result = await pool.query<{ count: number; retry_after: number }>(
		`with clock as (select floor(extract(epoch from clock_timestamp()) * 1000)::bigint as ms)
		insert into mcp_rate_limit as limits (key_hash, count, reset_at)
		select $1, 1, ms + $2 from clock
		on conflict (key_hash) do update set
		  count = case when limits.reset_at <= (select ms from clock) then 1 else limits.count + 1 end,
		  reset_at = case when limits.reset_at <= (select ms from clock) then (select ms from clock) + $2 else limits.reset_at end
		returning count, greatest(1, ceil((reset_at - (select ms from clock)) / 1000.0))::int as retry_after`,
		[keyHash, WINDOW_MS],
	);
	const row = result.rows[0];
	if (!row) throw new Error("MCP rate limit counter unavailable");
	return row.count > LIMIT ? row.retry_after : null;
}

export function mcpRateLimitedResponse(retryAfterSeconds: number): Response {
	return Response.json(
		{
			jsonrpc: "2.0",
			error: {
				code: -32029,
				message: `Too many requests. Retry after ${retryAfterSeconds}s.`,
			},
			id: null,
		},
		{ status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
	);
}
