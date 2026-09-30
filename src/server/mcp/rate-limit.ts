type Bucket = { count: number; resetAt: number };

declare global {
	// eslint-disable-next-line no-var
	var __fortunaMcpRateLimits: Map<string, Bucket> | undefined;
}

const WINDOW_MS = 60_000;
const LIMIT = 120;

function buckets(): Map<string, Bucket> {
	if (!globalThis.__fortunaMcpRateLimits)
		globalThis.__fortunaMcpRateLimits = new Map();
	return globalThis.__fortunaMcpRateLimits;
}

/** Returns seconds to wait when the key is over its limit, otherwise null. */
export function enforceMcpRateLimit(key: string): number | null {
	const now = Date.now();
	const map = buckets();
	const bucket = map.get(key);
	if (!bucket || bucket.resetAt <= now) {
		map.set(key, { count: 1, resetAt: now + WINDOW_MS });
		return null;
	}
	bucket.count += 1;
	if (bucket.count > LIMIT) return Math.ceil((bucket.resetAt - now) / 1000);
	return null;
}

export function mcpRateLimitedResponse(retryAfterSeconds: number): Response {
	return Response.json(
		{
			jsonrpc: "2.0",
			error: {
				code: -32029,
				message: `Too many requests. Retry after ${retryAfterSeconds}s.`,
			},
			id: null,
		},
		{ status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
	);
}
