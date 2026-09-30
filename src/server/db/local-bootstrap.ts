import { readMigrationFiles } from "drizzle-orm/migrator";
import type { Pool } from "pg";

export function assertLocalBootstrapTarget(
	connectionString: string,
	mode?: string,
): void {
	const url = new URL(connectionString);
	const database = decodeURIComponent(url.pathname.slice(1));
	if (
		mode === "production" ||
		!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
		!(
			database === "fortuna_dev" ||
			database === "fortuna_test" ||
			database.startsWith("fortuna_demo_")
		)
	)
		throw new Error(
			"Bootstrap is restricted to local fortuna_dev, fortuna_test, or fortuna_demo_* databases.",
		);
}

/** Commit each historical file separately so newly added enum values become usable. */
export async function bootstrapLocalDatabase(pool: Pool): Promise<number> {
	assertLocalBootstrapTarget(
		process.env.DATABASE_URL ?? "",
		process.env.NODE_ENV,
	);
	const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
	const client = await pool.connect();
	let applied = 0;
	try {
		await client.query("SELECT pg_advisory_lock(18627451)");
		const ledger = await client.query(
			"SELECT to_regclass('drizzle.__drizzle_migrations') AS name",
		);
		if (!ledger.rows[0]?.name) {
			const tables = await client.query(
				"SELECT 1 FROM pg_tables WHERE schemaname = 'public' LIMIT 1",
			);
			if (tables.rowCount)
				throw new Error(
					"Refusing a populated database without a migration ledger.",
				);
		}
		await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
		await client.query(
			"CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)",
		);
		const history = await client.query<{ hash: string; created_at: string }>(
			"SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at",
		);
		for (const [index, row] of history.rows.entries()) {
			const migration = migrations[index];
			if (
				!migration ||
				migration.hash !== row.hash ||
				migration.folderMillis !== Number(row.created_at)
			) {
				throw new Error(
					"The migration ledger does not match this source snapshot.",
				);
			}
		}
		for (const migration of migrations.slice(history.rows.length)) {
			await client.query("BEGIN");
			try {
				for (const statement of migration.sql)
					if (statement.trim()) await client.query(statement);
				await client.query(
					"INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
					[migration.hash, migration.folderMillis],
				);
				await client.query("COMMIT");
				applied++;
			} catch (error) {
				await client.query("ROLLBACK");
				throw error;
			}
		}
		return applied;
	} finally {
		await client
			.query("SELECT pg_advisory_unlock(18627451)")
			.catch(() => undefined);
		client.release();
	}
}
