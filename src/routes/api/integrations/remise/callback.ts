import { createFileRoute } from "@tanstack/react-router";
import { logger } from "@/server/logger";
import {
	providerErrorClass,
	providerHttpStatus,
} from "@/server/provider-errors";
import {
	completeRemiseConnection,
	failRemiseConnection,
} from "@/server/services/remise";

function redirect(result: "connected" | "error", imported = 0) {
	const query =
		result === "connected"
			? `?remise=connected&imported=${imported}`
			: "?remise=error";
	return new Response(null, {
		status: 303,
		headers: {
			location: `/settings/data-sources${query}`,
			"cache-control": "no-store",
		},
	});
}

export const Route = createFileRoute("/api/integrations/remise/callback")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const url = new URL(request.url);
				const state = url.searchParams.get("state") ?? "";
				const code = url.searchParams.get("code") ?? "";
				// The provider's error text is attacker-reachable; keep our own.
				const providerError = url.searchParams.get("error");
				if (!state || !code || providerError) {
					if (state) {
						await failRemiseConnection(
							state,
							"Remise-Freigabe wurde nicht abgeschlossen.",
						);
					}
					return redirect("error");
				}
				try {
					const result = await completeRemiseConnection(state, code);
					return redirect("connected", result.created + result.updated);
				} catch (error) {
					await failRemiseConnection(
						state,
						"Remise-Verbindung fehlgeschlagen.",
					);
					logger.error("Remise callback failed", {
						event: "remise.callback_failed",
						errorClass: providerErrorClass(error),
						providerStatus: providerHttpStatus(error),
					});
					return redirect("error");
				}
			},
		},
	},
});
