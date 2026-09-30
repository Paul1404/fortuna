import { createFileRoute, redirect } from "@tanstack/react-router";

// A Sparmission is now a status on its Fixkosten item.
export const Route = createFileRoute("/_app/optimizations/")({
	beforeLoad: () => {
		throw redirect({ to: "/fixed-costs", replace: true });
	},
});
