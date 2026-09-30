import { QueryClient } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { routeTree } from "./routeTree.gen";

export interface RouterContext {
	queryClient: QueryClient;
}

export function getRouter() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
	});
	const router = createTanStackRouter({
		routeTree,
		context: { queryClient } satisfies RouterContext,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 30_000,
		scrollRestoration: true,
		defaultStructuralSharing: true,
		// Pages crossfade (src/styles.css sets the duration); the navigation
		// rail carries its own view-transition-name and holds still.
		defaultViewTransition: true,
	});
	setupRouterSsrQueryIntegration({ router, queryClient });
	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
