import { createFileRoute, redirect } from "@tanstack/react-router";

// Hand-entered securities were removed in 0.59.0. The broker depot lives under
// Konten → Depots; old bookmarks and links land there.
export const Route = createFileRoute("/_app/investments")({
	beforeLoad: () => {
		throw redirect({ to: "/accounts", replace: true });
	},
});
