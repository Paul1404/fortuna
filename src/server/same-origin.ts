export function validateSameOriginRequest(
	request: Request,
	options: { baseUrl?: string; nodeEnv?: string } = {},
): Response | null {
	const origin = request.headers.get("origin");
	const allowed = new Set<string>();
	const configured = options.baseUrl?.trim();
	if (configured) allowed.add(new URL(configured).origin);
	if (options.nodeEnv !== "production") {
		allowed.add(new URL(request.url).origin);
	}
	if (!origin || !allowed.has(origin)) {
		return new Response("Ungültiger Ursprung", { status: 403 });
	}
	const fetchSite = request.headers.get("sec-fetch-site");
	if (fetchSite && fetchSite !== "same-origin") {
		return new Response("Ungültiger Anfragekontext", { status: 403 });
	}
	return null;
}
