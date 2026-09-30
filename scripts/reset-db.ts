#!/usr/bin/env bun
/**
 * Drop every table in the connected database and re-apply migrations.
 * Development only: refuses to run when NODE_ENV=production.
 */
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "@/server/db";

if (process.env.NODE_ENV === "production") {
	console.error("Refusing to reset a production database");
	process.exit(1);
}

await db.execute(sql`drop schema public cascade`);
await db.execute(sql`create schema public`);
await db.execute(sql`drop schema if exists drizzle cascade`);
await migrate(db, { migrationsFolder: "./drizzle" });
await pool.end();
console.log("Database reset and migrated");
