import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { objectStorageReady } from "@/server/object-storage";
import packageJson from "../../../package.json";

// Health check for Railway. Verifies the database answers; reveals nothing
// about the data.
export const Route = createFileRoute("/api/health")({
	server: {
		handlers: {
			GET: async () => {
				const started = performance.now();
				try {
					await db.execute(sql`select 1`);
					return Response.json({
						ok: true,
						db: true,
						objectStorage: await objectStorageReady(),
						version: packageJson.version,
						latencyMs: Math.round(performance.now() - started),
					});
				} catch {
					return Response.json(
						{ ok: false, db: false, version: packageJson.version },
						{ status: 503 },
					);
				}
			},
		},
	},
});
