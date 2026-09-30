// A failing provider call can carry the provider's own response body in its
// error message — a stack trace, a JSON payload, sometimes an echoed token.
// Nothing here may reach a log line, the database or the browser, so callers
// build their message from the error's shape instead of its text.

/** The HTTP status a provider error carries, when it looks like one. */
export function providerHttpStatus(error: unknown): number | null {
	if (!error || typeof error !== "object") return null;
	for (const key of ["code", "status", "statusCode"]) {
		const value = (error as Record<string, unknown>)[key];
		if (typeof value === "number" && value >= 100 && value <= 599) return value;
	}
	return null;
}

/** A short, safe class name for structured logs. */
export function providerErrorClass(error: unknown): string {
	if (!(error instanceof Error)) return "unknown";
	return /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : "other";
}

/**
 * A German message the owner can act on, carrying at most an HTTP status.
 * `fallback` describes the operation, e.g. "Kataster ist nicht erreichbar".
 */
export function safeProviderMessage(error: unknown, fallback: string): string {
	const status = providerHttpStatus(error);
	return status ? `${fallback} (HTTP ${status}).` : `${fallback}.`;
}
