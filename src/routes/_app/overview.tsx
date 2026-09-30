import { createFileRoute, redirect } from "@tanstack/react-router";

// Übersicht was merged into Vermögen; the desk at / is the only home.
export const Route = createFileRoute("/_app/overview")({
	beforeLoad: () => {
		throw redirect({ to: "/net-worth", replace: true });
	},
});
