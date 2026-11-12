import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/server/db";
import { user } from "@/server/db/auth-schema";
import { externalConnections } from "@/server/db/schema";
import { disconnectCopilot } from "@/server/services/copilot";

const enabled = process.env.FORTUNA_INTEGRATION_TEST === "1";
const d = enabled ? describe : describe.skip;

d("Copilot auth generation against PostgreSQL", () => {
	const userId = `it-copilot-${randomUUID()}`;

	beforeAll(async () => {
		await db.insert(user).values({
			id: userId,
			name: "Copilot integration",
			email: `${userId}@example.invalid`,
		});
		await db.insert(externalConnections).values({
			userId,
			provider: "openai-chatgpt",
			status: "active",
			encryptedSecret: "test-ciphertext-only",
			copilotAuthGeneration: 7n,
		});
	});

	afterAll(async () => {
		await db.delete(user).where(eq(user.id, userId));
		await pool.end();
	});

	it("backfills a populated pre-generation table before setting NOT NULL", async () => {
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			await client.query(
				"CREATE TEMP TABLE external_connections (id text PRIMARY KEY, note text)",
			);
			await client.query(
				"INSERT INTO external_connections (id, note) VALUES ('prior-row', 'retained')",
			);
			const migration = await readFile(
				new URL(
					"../../drizzle/0058_copilot_auth_generation.sql",
					import.meta.url,
				),
				"utf8",
			);
			await client.query(migration);
			const result = await client.query<{
				id: string;
				note: string;
				copilot_auth_generation: string;
			}>(
				"SELECT id, note, copilot_auth_generation FROM external_connections WHERE id = 'prior-row'",
			);
			expect(result.rows).toEqual([
				{ id: "prior-row", note: "retained", copilot_auth_generation: "0" },
			]);
		} finally {
			await client.query("ROLLBACK");
			client.release();
		}
	});

	it("prevents a stale auth write from undoing disconnect", async () => {
		await disconnectCopilot(userId);
		const staleWrite = await db
			.update(externalConnections)
			.set({ status: "active", encryptedSecret: "stale-test-ciphertext" })
			.where(
				and(
					eq(externalConnections.userId, userId),
					eq(externalConnections.provider, "openai-chatgpt"),
					eq(externalConnections.copilotAuthGeneration, 7n),
					inArray(externalConnections.status, ["pending", "active"]),
				),
			)
			.returning({ id: externalConnections.id });
		const current = await db.query.externalConnections.findFirst({
			where: and(
				eq(externalConnections.userId, userId),
				eq(externalConnections.provider, "openai-chatgpt"),
			),
		});
		expect(staleWrite).toEqual([]);
		expect(current).toMatchObject({
			status: "disconnected",
			encryptedSecret: null,
			copilotAuthGeneration: 8n,
		});
	});
});
