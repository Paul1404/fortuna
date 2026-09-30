import { createFileRoute, redirect } from "@tanstack/react-router";

// Verbindlichkeiten is a tab of Forderungen & Schulden; a search hit or a
// desk task keeps its row and sheet.
export const Route = createFileRoute("/_app/liabilities/")({
	beforeLoad: ({ location }) => {
		const { highlight, sheet } = location.search as {
			highlight?: unknown;
			sheet?: unknown;
		};
		throw redirect({
			to: "/debts",
			search: {
				tab: "liabilities",
				...(typeof highlight === "string" ? { highlight } : {}),
				...(typeof sheet === "string" ? { sheet } : {}),
			},
			replace: true,
		});
	},
});
