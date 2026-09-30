import { createFileRoute, redirect } from "@tanstack/react-router";

// Forderungen is a tab of Forderungen & Schulden; a search hit keeps its row.
export const Route = createFileRoute("/_app/receivables/")({
	beforeLoad: ({ location }) => {
		const { highlight } = location.search as { highlight?: unknown };
		throw redirect({
			to: "/debts",
			search: typeof highlight === "string" ? { highlight } : {},
			replace: true,
		});
	},
});
