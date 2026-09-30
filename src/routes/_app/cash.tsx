import { createFileRoute, redirect } from "@tanstack/react-router";

// Bargeld is an account type, not a page: a wallet is listed under Konten and
// its spends and counts are entered on its own account page.
export const Route = createFileRoute("/_app/cash")({
	beforeLoad: () => {
		throw redirect({ to: "/accounts", replace: true });
	},
});
