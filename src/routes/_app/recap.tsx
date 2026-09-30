import { createFileRoute, redirect } from "@tanstack/react-router";

// Rückblick's pickers now drive the one history chart on Vermögen; a saved
// link keeps its metric, interval, period and mode (Vermögen validates them).
export const Route = createFileRoute("/_app/recap")({
	beforeLoad: ({ location }) => {
		throw redirect({
			to: "/net-worth",
			search: location.search as Record<string, never>,
			replace: true,
		});
	},
});
