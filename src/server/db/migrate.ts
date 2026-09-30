import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { logger } from "../logger";
import { ensureOwnerFromEnv } from "../services/owner";
import { db, pool } from "./index";

// Production migrator. Runs as the Railway preDeploy step in a separate
// container clone with the same env, before the app starts. Applies pending
// Drizzle migrations and creates the owner account from env on first deploy.

async function main(): Promise<void> {
	const startedAt = performance.now();
	await migrate(db, { migrationsFolder: "./drizzle" });
	const repaired = await repairAfterMigrations();
	const owner = await ensureOwnerFromEnv();
	await pool.end();
	logger.info("Database migration completed", {
		event: "database.migration.completed",
		durationMs: Math.round(performance.now() - startedAt),
		owner,
		repaired,
	});
}

/**
 * Data repairs that cannot live in a migration file.
 *
 * Drizzle runs every pending migration inside one transaction, and Postgres
 * refuses to use an enum value that was added in the transaction still running
 * — "unsafe use of new value". Anything that has to write a freshly added enum
 * value therefore belongs here, after the migrator has committed. Each repair
 * must be idempotent: this runs on every deploy.
 */
async function repairAfterMigrations(): Promise<Record<string, number>> {
	// PayPal arrived as a current account, because that is the fallback for an
	// ISO cash account type Fortuna does not recognise, and the Konten page
	// then called a payment service "Girokonto". A type the owner set himself
	// is left alone: only accounts a provider created are touched.
	const wallets = await db.execute(sql`
		UPDATE accounts SET type = 'wallet'
		WHERE provider_account_id IS NOT NULL
			AND type = 'current'
			AND institution ILIKE '%paypal%'
	`);
	// Recurring amounts are signed by direction. Rows created through the
	// Copilot or MCP before the service enforced it carry a positive outflow,
	// which the forecast counted as income.
	const recurringSigns = await db.execute(sql`
		UPDATE recurring_payments
		SET expected_amount_minor = -abs(expected_amount_minor),
			previous_amount_minor = -abs(previous_amount_minor)
		WHERE direction = 'outflow' AND expected_amount_minor > 0
	`);
	const inflowSigns = await db.execute(sql`
		UPDATE recurring_payments
		SET expected_amount_minor = abs(expected_amount_minor),
			previous_amount_minor = abs(previous_amount_minor)
		WHERE direction = 'inflow' AND expected_amount_minor < 0
	`);
	return {
		wallets: wallets.rowCount ?? 0,
		recurringSigns:
			(recurringSigns.rowCount ?? 0) + (inflowSigns.rowCount ?? 0),
	};
}

main().catch(async (err) => {
	logger.error("Database migration failed", {
		event: "database.migration.failed",
		err,
	});
	await pool.end().catch(() => undefined);
	process.exit(1);
});
