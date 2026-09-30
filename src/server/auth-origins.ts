// The dev origin is only trusted outside production; in production it would let
// a page on the user's own machine talk to the deployed auth endpoints.
export function resolveTrustedOrigins(
	baseUrl: string | undefined,
	aliases: string | undefined,
	nodeEnv: string | undefined = process.env.NODE_ENV,
): string[] {
	const origins = new Set<string>(
		nodeEnv === "production" ? [] : ["http://localhost:3000"],
	);
	for (const origin of [baseUrl, ...(aliases ?? "").split(",")]) {
		const normalized = origin?.trim().replace(/\/$/, "");
		if (normalized) origins.add(normalized);
	}
	return Array.from(origins);
}
