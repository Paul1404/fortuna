import { ORPCError, os } from "@orpc/server";
import { markDataChanged } from "@/server/data-revision";
import { logger } from "@/server/logger";

export type AuthUser = { id: string; email: string; name: string };

export type ORPCContext = {
	user: AuthUser | null;
	headers: Headers;
	requestId: string;
	/** "session" for browser calls, "mcp" for the read-only MCP token. */
	principal: "session" | "mcp";
};

const base = os.$context<ORPCContext>();

// Outermost middleware: log unexpected failures with context, debug-log the
// expected ORPCErrors, and never leak internals to the client.
const logging = base.middleware(async ({ context, next, path }) => {
	try {
		return await next();
	} catch (err) {
		const procedure = Array.isArray(path) ? path.join(".") : undefined;
		if (err instanceof ORPCError) {
			logger.debug("procedure rejected", {
				event: "orpc.rejected",
				requestId: context.requestId,
				procedure,
				code: err.code,
			});
			throw err;
		}
		logger.error("procedure failed", {
			event: "orpc.failed",
			requestId: context.requestId,
			procedure,
			err,
		});
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "Etwas ist schiefgelaufen",
		});
	}
});

const requireUser = base.middleware(async ({ context, next }) => {
	if (!context.user)
		throw new ORPCError("UNAUTHORIZED", { message: "Nicht angemeldet" });
	return next({ context: { ...context, user: context.user } });
});

// Mutations are only allowed for a real browser session, never for the MCP
// token, so an AI client can read but not change anything.
const requireSession = base.middleware(async ({ context, next }) => {
	if (!context.user)
		throw new ORPCError("UNAUTHORIZED", { message: "Nicht angemeldet" });
	if (context.principal !== "session")
		throw new ORPCError("FORBIDDEN", { message: "Nur Lesezugriff" });
	const result = await next({ context: { ...context, user: context.user } });
	markDataChanged(context.user.id);
	return result;
});

/** Session-gated provider reads that must not be reachable through MCP. */
const requireSessionRead = base.middleware(async ({ context, next }) => {
	if (!context.user)
		throw new ORPCError("UNAUTHORIZED", { message: "Nicht angemeldet" });
	if (context.principal !== "session")
		throw new ORPCError("FORBIDDEN", { message: "Nur Lesezugriff" });
	return next({ context: { ...context, user: context.user } });
});

export const pub = base.use(logging);
export const authed = pub.use(requireUser);
export const mutation = pub.use(requireSession);
export const sessionRead = pub.use(requireSessionRead);
