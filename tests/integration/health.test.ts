import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@/server/db";
import {
	checkDatabaseSchema,
	expectedDatabaseColumns,
} from "@/server/db/health";

const d =
	process.env.FORTUNA_INTEGRATION_TEST === "1" ? describe : describe.skip;

d("schema readiness against PostgreSQL", () => {
	afterAll(() => pool.end());
	it("accepts the migrated app and authentication schema without reading owner records", async () => {
		expect(
			expectedDatabaseColumns.some((column) => column.table_name === "session"),
		).toBe(true);
		expect(
			expectedDatabaseColumns.some(
				(column) =>
					column.table_name === "financial_observations" &&
					column.column_name === "read_at",
			),
		).toBe(true);
		expect(await checkDatabaseSchema(pool)).toEqual({ db: true, schema: true });
	});
	it("distinguishes an available database from a missing table or column", async () => {
		for (const entry of [
			{
				schema_name: "public",
				table_name: "missing_readiness_table",
				column_name: "id",
			},
			{
				schema_name: "public",
				table_name: "user_settings",
				column_name: "missing_readiness_column",
			},
		]) {
			expect(
				await checkDatabaseSchema(pool, [...expectedDatabaseColumns, entry]),
			).toEqual({ db: true, schema: false });
		}
	});
});
