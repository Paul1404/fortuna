import {
	createCsrfMiddleware,
	createMiddleware,
	createStart,
} from "@tanstack/react-start";

// Creating src/start.ts replaces TanStack Start's implicit default, so the
// server-function CSRF protection is re-added explicitly.
const csrf = createCsrfMiddleware({
	filter: (context) => context.handlerType === "serverFn",
});

// Framing protection matters for an app that holds a person's full financial
// picture behind a session cookie; the rest is cheap defence in depth.
const securityHeaders = createMiddleware({ type: "request" }).server(
	async ({ next }) => {
		const result = await next();
		const headers = result.response.headers;
		headers.set("X-Frame-Options", "DENY");
		headers.set("X-Content-Type-Options", "nosniff");
		headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
		headers.set(
			"Permissions-Policy",
			"camera=(), microphone=(), geolocation=()",
		);
		return result;
	},
);

export const startInstance = createStart(() => ({
	requestMiddleware: [securityHeaders, csrf],
}));
