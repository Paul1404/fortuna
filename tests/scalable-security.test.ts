import { describe, expect, it } from "vitest";
import { serializeLogValue } from "@/server/logger";

describe("Scalable log boundary", () => {
	it("redacts relay credentials and sensitive account identifiers in structured diagnostics", () => {
		const serialized = serializeLogValue({
			token: "example-relay-secret",
			accountIban: "DE44500105175407324931",
			provider: "scalable",
			event: "scalable.cli.sync.failed",
		}) as Record<string, unknown>;
		expect(serialized.token).toBe("[redacted]");
		expect(serialized.accountIban).toBe("[redacted]");
		expect(serialized.event).toBe("scalable.cli.sync.failed");
	});
});
