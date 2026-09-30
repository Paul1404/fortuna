const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requestIdFromHeaders(headers: Headers): string {
	const incoming = headers.get("x-request-id")?.trim();
	return incoming && UUID_PATTERN.test(incoming)
		? incoming
		: crypto.randomUUID();
}
