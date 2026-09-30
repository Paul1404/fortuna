import { createFileRoute, redirect } from "@tanstack/react-router";

// Import & Export is part of Einstellungen › Datenquellen.
export const Route = createFileRoute("/_app/imports/")({
	beforeLoad: () => {
		throw redirect({ to: "/settings/data-sources", replace: true });
	},
});
