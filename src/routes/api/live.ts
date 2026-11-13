import { createFileRoute } from "@tanstack/react-router";

/** Liveness deliberately avoids external services and application data. */
export const Route = createFileRoute("/api/live")({
	server: {
		handlers: {
			GET: () =>
				Response.json(
					{ ok: true },
					{ headers: { "Cache-Control": "no-store" } },
				),
		},
	},
});
