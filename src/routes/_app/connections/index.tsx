import { createFileRoute, redirect } from "@tanstack/react-router";
import { connectionResultSearch } from "@/components/connections-panel";

// Verbindungen is part of Einstellungen › Datenquellen. A bank or Remise
// result in the URL is carried over so it is still reported.
export const Route = createFileRoute("/_app/connections/")({
	beforeLoad: ({ location }) => {
		throw redirect({
			to: "/settings/data-sources",
			search: connectionResultSearch(
				location.search as Record<string, unknown>,
			),
			replace: true,
		});
	},
});
