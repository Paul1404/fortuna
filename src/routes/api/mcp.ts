import { createFileRoute } from "@tanstack/react-router";
import { handleMcpRequest } from "@/server/mcp/server";

export const Route = createFileRoute("/api/mcp")({
	server: {
		handlers: {
			GET: ({ request }) => handleMcpRequest(request),
			POST: ({ request }) => handleMcpRequest(request),
			DELETE: ({ request }) => handleMcpRequest(request),
		},
	},
});
