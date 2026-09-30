import { createFileRoute } from "@tanstack/react-router";
import { logger } from "@/server/logger";
import { createORPCContext } from "@/server/orpc/context";
import { EnableBankingCredentialError } from "@/server/providers/bank/enable-banking-key";
import { isRequestTooLarge, withBodyLimit } from "@/server/request-limits";
import { validateSameOriginRequest } from "@/server/same-origin";
import { storeEnableBankingCredential } from "@/server/services/provider-credentials";

const MAX_REQUEST_BYTES = 64 * 1024;

export const Route = createFileRoute(
	"/api/provider-credentials/enable-banking",
)({
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
				const contentLength = Number(request.headers.get("content-length"));
				if (
					Number.isFinite(contentLength) &&
					contentLength > MAX_REQUEST_BYTES
				) {
					return new Response("Datei ist zu groß", { status: 413 });
				}
				const context = await createORPCContext(request);
				if (!context.user) {
					return new Response("Nicht angemeldet", { status: 401 });
				}
				try {
					const form = await withBodyLimit(
						request,
						MAX_REQUEST_BYTES,
					).formData();
					const applicationId = form.get("applicationId");
					const privateKey = form.get("privateKey");
					if (
						typeof applicationId !== "string" ||
						!(privateKey instanceof File)
					) {
						return new Response(
							"Anwendungs-ID und PEM-Datei sind erforderlich",
							{
								status: 400,
							},
						);
					}
					const result = await storeEnableBankingCredential(context.user.id, {
						applicationId,
						privateKeyPem: await privateKey.text(),
					});
					logger.info("Enable Banking credential stored", {
						event: "provider_credential.stored",
						requestId: context.requestId,
						provider: "enable-banking",
						keyFingerprint: result.keyFingerprint?.slice(0, 16),
					});
					return Response.json(result, {
						headers: { "cache-control": "no-store" },
					});
				} catch (error) {
					if (isRequestTooLarge(error))
						return new Response("Die Anfrage ist zu groß", { status: 413 });
					if (error instanceof EnableBankingCredentialError) {
						return new Response(error.message, { status: 400 });
					}
					logger.error("Enable Banking credential upload failed", {
						event: "provider_credential.store_failed",
						requestId: context.requestId,
						err: error,
					});
					return new Response("Schlüssel konnte nicht gespeichert werden", {
						status: 500,
					});
				}
			},
		},
	},
});
