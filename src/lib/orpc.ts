import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import type { AppRouter } from "@/server/orpc/router";

// Isomorphic oRPC client. In the browser it targets the page origin; during
// SSR it hits the container loopback and forwards the session cookie. The
// server branches are stripped from the client bundle.

// Vite's dev server listens on [::1] only, so "localhost" is required there;
// the production Nitro server binds every interface and 127.0.0.1 avoids a
// DNS lookup per request.
const resolveUrl = createIsomorphicFn()
	.server(
		() =>
			`http://${process.env.NODE_ENV === "production" ? "127.0.0.1" : "localhost"}:${process.env.PORT ?? "3000"}/api/rpc`,
	)
	.client(() => `${window.location.origin}/api/rpc`);

const resolveHeaders = createIsomorphicFn()
	.server((): Record<string, string> => {
		const headers = new Headers(getRequestHeaders() as HeadersInit);
		const cookie = headers.get("cookie");
		return cookie ? { cookie } : {};
	})
	.client((): Record<string, string> => ({}));

const link = new RPCLink({
	url: () => resolveUrl(),
	headers: () => resolveHeaders(),
});

export const orpcClient: RouterClient<AppRouter> = createORPCClient(link);
export const orpc = createTanstackQueryUtils(orpcClient);
