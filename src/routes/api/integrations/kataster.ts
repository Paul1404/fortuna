import { createFileRoute } from "@tanstack/react-router";
import { logger } from "@/server/logger";
import { createORPCContext } from "@/server/orpc/context";
import { isRequestTooLarge, withBodyLimit } from "@/server/request-limits";
import { validateSameOriginRequest } from "@/server/same-origin";
import {
	KatasterConnectionError,
	storeKatasterConnection,
} from "@/server/services/kataster";

const MAX_REQUEST_BYTES = 16 * 1024;

export const Route = createFileRoute("/api/integrations/kataster")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const boundaryError = validateSameOriginRequest(request, {
					baseUrl: process.env.BETTER_AUTH_URL,
					nodeEnv: process.env.NODE_ENV,
				});
				if (boundaryError) return boundaryError;
				const contentLength = Number(request.headers.get("content-length"));
				if (
					Number.isFinite(contentLength) &&
					contentLength > MAX_REQUEST_BYTES
				) {
					return new Response("Anfrage ist zu groß", { status: 413 });
				}
				const context = await createORPCContext(request);
				if (!context.user)
					return new Response("Nicht angemeldet", { status: 401 });
				try {
					const form = await withBodyLimit(
						request,
						MAX_REQUEST_BYTES,
					).formData();
					const baseUrl = form.get("baseUrl");
					const token = form.get("token");
					if (typeof baseUrl !== "string" || typeof token !== "string") {
						return new Response("Adresse und Token sind erforderlich", {
							status: 400,
						});
					}
					const result = await storeKatasterConnection(context.user.id, {
						baseUrl,
						token,
					});
					logger.info("Kataster connection stored", {
						event: "kataster.connection.stored",
						requestId: context.requestId,
						baseUrl: result.baseUrl,
					});
					return Response.json(result, {
						headers: { "cache-control": "no-store" },
					});
				} catch (error) {
					if (isRequestTooLarge(error))
						return new Response("Die Anfrage ist zu groß", { status: 413 });
					if (error instanceof KatasterConnectionError) {
						return new Response(error.message, { status: 400 });
					}
					logger.error("Kataster connection failed", {
						event: "kataster.connection.failed",
						requestId: context.requestId,
						err: error,
					});
					return new Response("Kataster konnte nicht verbunden werden", {
						status: 502,
					});
				}
			},
		},
	},
});
