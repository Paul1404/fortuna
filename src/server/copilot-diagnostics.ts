const TRACE_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function copilotTraceId(value: string | null): string {
	return value && TRACE_ID_PATTERN.test(value) ? value : crypto.randomUUID();
}

// Error messages can contain provider responses or user data. Log only a known class.
export function copilotErrorClass(error: unknown): string {
	if (!(error instanceof Error)) return "unknown";
	return ["AbortError", "Error", "TypeError", "ORPCError"].includes(error.name)
		? error.name
		: "other";
}

export function startCopilotHeartbeats(send: () => boolean): () => void {
	if (!send()) return () => undefined;
	const timer = setInterval(() => {
		if (!send()) clearInterval(timer);
	}, 5_000);
	return () => clearInterval(timer);
}
