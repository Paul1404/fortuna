import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as authSchema from "./auth-schema";
import * as appSchema from "./schema";

// Server-only Drizzle client. Never import this from a component: all DB access
// goes through services called by oRPC procedures, server routes or scripts.

const schema = { ...appSchema, ...authSchema };

declare global {
	// eslint-disable-next-line no-var
	var __fortunaPool: Pool | undefined;
}

function timeoutFromEnv(name: string, fallback: number): number {
	const value = Number(process.env[name]);
	return Number.isInteger(value) && value >= 1_000 && value <= 120_000
		? value
		: fallback;
}

function createPool(): Pool {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		throw new Error("DATABASE_URL is not set");
	}
	return new Pool({
		connectionString,
		max: 10,
		idleTimeoutMillis: 20_000,
		connectionTimeoutMillis: timeoutFromEnv(
			"DATABASE_CONNECTION_TIMEOUT_MS",
			5_000,
		),
		query_timeout: timeoutFromEnv("DATABASE_QUERY_TIMEOUT_MS", 15_000),
		statement_timeout: timeoutFromEnv("DATABASE_QUERY_TIMEOUT_MS", 15_000),
	});
}

const pool = globalThis.__fortunaPool ?? createPool();
if (process.env.NODE_ENV !== "production") {
	globalThis.__fortunaPool = pool;
}

export const db = drizzle(pool, { schema });
export { pool, schema };

export type Database = typeof db;
export type DbOrTx =
	| Database
	| Parameters<Parameters<Database["transaction"]>[0]>[0];
