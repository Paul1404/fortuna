import { createFileRoute, redirect } from "@tanstack/react-router";

// Wiederkehrend became part of Fixkosten; a search hit keeps its item.
export const Route = createFileRoute("/_app/recurring/")({
	beforeLoad: ({ location }) => {
		const { highlight } = location.search as { highlight?: unknown };
		throw redirect({
			to: "/fixed-costs",
			search: typeof highlight === "string" ? { highlight } : {},
			replace: true,
		});
	},
});
