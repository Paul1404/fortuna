import { createFileRoute } from "@tanstack/react-router";
import { logger } from "@/server/logger";
import { EnableBankingApiError } from "@/server/providers/bank/enable-banking-client";
import {
	completeEnableBankingConnection,
	EnableBankingAuthorizationError,
	EnableBankingSyncError,
	failEnableBankingConnection,
	wasRecentlyCompleted,
} from "@/server/services/enable-banking";

function redirect(result: "connected" | "error", imported = 0) {
	const suffix =
		result === "connected"
			? `?bank=connected&imported=${imported}`
			: "?bank=error";
	return new Response(null, {
		status: 303,
		headers: {
			location: `/settings/data-sources${suffix}`,
			"cache-control": "no-store",
		},
	});
}

export const Route = createFileRoute("/api/bank/enable-banking/callback")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const url = new URL(request.url);
				const state = url.searchParams.get("state") ?? "";
				const code = url.searchParams.get("code") ?? "";
				const providerError = url.searchParams.get("error_description");
				if (!state || !code || providerError) {
					if (state) await failEnableBankingConnection(state);
					return redirect("error");
				}
				try {
					const result = await completeEnableBankingConnection(state, code);
					return redirect("connected", result.imported);
				} catch (error) {
					// The same redirect delivered twice: the first call already did
					// the work, so this is a success the owner has seen, not a failure.
					if (
						error instanceof EnableBankingAuthorizationError &&
						error.reason === "connection_not_found" &&
						wasRecentlyCompleted(state)
					)
						return redirect("connected");
					// Telling the owner the approval was not completed when it was is
					// worse than saying nothing, so the real reason is persisted. A
					// failed first read never reaches this row: the state was rotated
					// once the session existed, and completeEnableBankingConnection
					// has already said so. What lands here failed before that, most
					// often at the session exchange, so the approval is not complete.
					await failEnableBankingConnection(
						state,
						error instanceof EnableBankingAuthorizationError
							? error.message
							: "Bankfreigabe konnte nicht abgeschlossen werden. Bitte erneut verbinden.",
					);
					const failure =
						error instanceof EnableBankingSyncError ? error.cause : error;
					logger.error("Enable Banking callback failed", {
						event: "enable_banking.callback_failed",
						stage:
							error instanceof EnableBankingSyncError
								? error.stage
								: "authorization",
						reason:
							error instanceof EnableBankingAuthorizationError
								? error.reason
								: undefined,
						errorName: failure instanceof Error ? failure.name : typeof failure,
						providerStatus:
							failure instanceof EnableBankingApiError
								? failure.status
								: undefined,
					});
					return redirect("error");
				}
			},
		},
	},
});
