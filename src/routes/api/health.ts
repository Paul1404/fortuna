import { createFileRoute } from "@tanstack/react-router";
import { healthCheck } from "@/server/health";

/** Readiness for deployments and external monitors, without owner data. */
export const Route = createFileRoute("/api/health")({
	server: {
		handlers: {
			GET: async () => {
				const body = await healthCheck();
				return Response.json(body, {
					status: body.ok ? 200 : 503,
					headers: { "Cache-Control": "no-store" },
				});
			},
		},
	},
});
