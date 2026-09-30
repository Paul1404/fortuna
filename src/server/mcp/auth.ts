import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { user } from "@/server/db/auth-schema";
import { mcpTokens } from "@/server/db/schema";
import type { ORPCContext } from "@/server/orpc/base";
import { requestIdFromHeaders } from "@/server/request-id";

// The MCP endpoint accepts two kinds of bearer token. A token created in the
// settings is stored hashed, carries a scope and can be revoked; the static
// MCP_BEARER_TOKEN from the environment still works and is always read-only,
// because a value that cannot be withdrawn must not be able to write.
//
// Either way oRPC runs with principal "mcp", which the mutation middleware
// rejects: write access is an explicit, reviewed list of tools, never the
// whole API surface.

export type McpScope = "read" | "read_write";

export type McpAuthContext = {
	orpc: ORPCContext & { user: NonNullable<ORPCContext["user"]> };
	tokenFingerprint: string;
	scope: McpScope;
	/** Set for a token from the settings, so its use can be recorded. */
	tokenId: string | null;
};

export function configuredMcpToken(): string | null {
	const value = process.env.MCP_BEARER_TOKEN?.trim();
	return value && value.length >= 32 ? value : null;
}

export async function authenticateMcpRequest(
	request: Request,
): Promise<McpAuthContext | null> {
	const authorization = request.headers.get("authorization");
	if (!authorization?.startsWith("Bearer ")) return null;
	const provided = authorization.slice("Bearer ".length).trim();
	if (provided.length < 32) return null;

	// A stored token is looked up by hash, so the token itself never needs to
	// exist anywhere but in the client that holds it.
	const hash = createHash("sha256").update(provided).digest("hex");
	const stored = await db.query.mcpTokens.findFirst({
		where: eq(mcpTokens.tokenHash, hash),
	});
	let scope: McpScope = "read";
	let tokenId: string | null = null;
	if (stored) {
		if (stored.revokedAt) return null;
		scope = stored.scope;
		tokenId = stored.id;
	} else {
		const expected = configuredMcpToken();
		if (!expected || !secureEqual(provided, expected)) return null;
	}

	const owner = await db.query.user.findFirst({
		orderBy: (u, { asc }) => [asc(u.createdAt)],
	});
	if (!owner) return null;
	if (tokenId)
		await db
			.update(mcpTokens)
			.set({ lastUsedAt: new Date() })
			.where(eq(mcpTokens.id, tokenId));
	const headers = new Headers(request.headers);
	const requestId = requestIdFromHeaders(headers);
	headers.set("x-request-id", requestId);
	return {
		scope,
		tokenId,
		tokenFingerprint: hash.slice(0, 16),
		orpc: {
			user: { id: owner.id, email: owner.email, name: owner.name },
			headers,
			requestId,
			principal: "mcp",
		},
	};
}

export function validateMcpRequestBoundary(request: Request): Response | null {
	const configured = process.env.BETTER_AUTH_URL?.trim();
	if (!configured) {
		return process.env.NODE_ENV === "production"
			? new Response("BETTER_AUTH_URL missing", { status: 503 })
			: null;
	}
	const expected = new URL(configured);
	const requested = new URL(request.url);
	if (requested.host !== expected.host)
		return new Response("invalid host", { status: 403 });
	const origin = request.headers.get("origin");
	if (origin && origin !== expected.origin)
		return new Response("invalid origin", { status: 403 });
	return null;
}

export function mcpUnauthorizedResponse(): Response {
	return Response.json(
		{
			jsonrpc: "2.0",
			error: { code: -32001, message: "Unauthorized" },
			id: null,
		},
		{ status: 401, headers: { "www-authenticate": "Bearer" } },
	);
}

function secureEqual(left: string, right: string): boolean {
	const a = Buffer.from(left);
	const b = Buffer.from(right);
	return a.length === b.length && timingSafeEqual(a, b);
}

export { eq, user };
