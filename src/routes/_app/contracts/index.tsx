import { createFileRoute, redirect } from "@tanstack/react-router";

// Verträge became part of Fixkosten; `?contract=<id>` opens that contract.
export const Route = createFileRoute("/_app/contracts/")({
	beforeLoad: ({ location }) => {
		const { contract } = location.search as { contract?: unknown };
		throw redirect({
			to: "/fixed-costs",
			search: typeof contract === "string" ? { contract } : {},
			replace: true,
		});
	},
});
