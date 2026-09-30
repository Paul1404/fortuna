import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/server/auth";
import { logger } from "@/server/logger";

async function handle({ request }: { request: Request }) {
	const url = new URL(request.url);
	const response = await auth.handler(request);
	if (request.method === "POST" && url.pathname.endsWith("/sign-in/email")) {
		logger.info(response.ok ? "Sign-in succeeded" : "Sign-in failed", {
			event: response.ok ? "auth.login.succeeded" : "auth.login.failed",
			status: response.status,
			userAgent: request.headers.get("user-agent"),
		});
	}
	return response;
}

export const Route = createFileRoute("/api/auth/$")({
	server: { handlers: { GET: handle, POST: handle } },
});
