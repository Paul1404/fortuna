import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@/server/db";
import { enforceMcpRateLimit } from "@/server/mcp/rate-limit";

const d =
	process.env.FORTUNA_INTEGRATION_TEST === "1" ? describe : describe.skip;

d("shared MCP rate limit", () => {
	afterAll(() => pool.end());
	it("atomically enforces the limit across concurrent requests without storing the raw key", async () => {
		const key = `synthetic:${randomUUID()}`;
		const hash = createHash("sha256").update(key).digest("hex");
		try {
			const results = await Promise.all(
				Array.from({ length: 121 }, () => enforceMcpRateLimit(key)),
			);
			expect(results.filter((value) => value === null)).toHaveLength(120);
			expect(results.filter((value) => value !== null)).toHaveLength(1);
			const row = await pool.query<{ key_hash: string; count: number }>(
				"select key_hash, count from mcp_rate_limit where key_hash = $1",
				[hash],
			);
			expect(row.rows).toEqual([{ key_hash: hash, count: 121 }]);
			await pool.query(
				"update mcp_rate_limit set reset_at = 0 where key_hash = $1",
				[hash],
			);
			expect(await enforceMcpRateLimit(key)).toBeNull();
			const reset = await pool.query<{ count: number }>(
				"select count from mcp_rate_limit where key_hash = $1",
				[hash],
			);
			expect(reset.rows[0]?.count).toBe(1);
		} finally {
			await pool.query("delete from mcp_rate_limit where key_hash = $1", [
				hash,
			]);
		}
	});
});
