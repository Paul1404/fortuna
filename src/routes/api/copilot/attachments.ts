import { createFileRoute } from "@tanstack/react-router";
import { logger } from "@/server/logger";
import { createORPCContext } from "@/server/orpc/context";
import { isRequestTooLarge, withBodyLimit } from "@/server/request-limits";
import { validateSameOriginRequest } from "@/server/same-origin";
import {
	CopilotAttachmentError,
	storeCopilotAttachments,
} from "@/server/services/copilot-attachments";

const MAX_REQUEST_BYTES = 25 * 1024 * 1024;

export const Route = createFileRoute("/api/copilot/attachments")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const boundaryError = validateSameOriginRequest(request, {
					baseUrl: process.env.BETTER_AUTH_URL,
					nodeEnv: process.env.NODE_ENV,
				});
				if (boundaryError) return boundaryError;
				if (
					!request.headers
						.get("content-type")
						?.startsWith("multipart/form-data")
				) {
					return new Response("Multipart-Formulardaten erforderlich", {
						status: 415,
					});
				}
				// A chunked request carries no content-length, so the declared size
				// is only a fast path; the body itself is capped below.
				const contentLength = Number(request.headers.get("content-length"));
				if (
					Number.isFinite(contentLength) &&
					contentLength > MAX_REQUEST_BYTES
				) {
					return new Response("Anhänge sind zusammen größer als 25 MB", {
						status: 413,
					});
				}
				const context = await createORPCContext(request);
				if (!context.user)
					return new Response("Nicht angemeldet", { status: 401 });
				try {
					const form = await withBodyLimit(
						request,
						MAX_REQUEST_BYTES,
					).formData();
					const files = form
						.getAll("files")
						.filter((value): value is File => value instanceof File);
					const attachments = await storeCopilotAttachments(
						context.user.id,
						files,
					);
					logger.info("Copilot attachments stored", {
						event: "copilot.attachments.stored",
						requestId: context.requestId,
						count: attachments.length,
						types: attachments.map((attachment) => attachment.kind),
					});
					return Response.json(
						{ attachments },
						{ headers: { "cache-control": "no-store" } },
					);
				} catch (error) {
					if (isRequestTooLarge(error))
						return new Response("Anhänge sind zusammen größer als 25 MB", {
							status: 413,
						});
					if (error instanceof CopilotAttachmentError) {
						return new Response(error.message, { status: 400 });
					}
					logger.error("Copilot attachment upload failed", {
						event: "copilot.attachments.failed",
						requestId: context.requestId,
						err: error,
					});
					return new Response("Anhänge konnten nicht verarbeitet werden", {
						status: 500,
					});
				}
			},
		},
	},
});
