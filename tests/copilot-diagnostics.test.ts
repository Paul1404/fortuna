import { afterEach, describe, expect, it, vi } from "vitest";
import {
	copilotErrorClass,
	copilotTraceId,
	startCopilotHeartbeats,
} from "@/server/copilot-diagnostics";

afterEach(() => vi.useRealTimers());

describe("Copilot diagnostics", () => {
	it("preserves a valid trace ID so browser and server logs correlate", () => {
		const id = "1d4dfad8-774f-49da-bcf2-57aa19bde35a";
		expect(copilotTraceId(id)).toBe(id);
	});

	it("replaces untrusted trace IDs", () => {
		expect(copilotTraceId("private prompt text")).toMatch(
			/^[0-9a-f]{8}-[0-9a-f-]{27,}$/,
		);
	});

	it("does not log arbitrary error names or messages", () => {
		const error = new Error("private provider response");
		error.name = "private user data";
		expect(copilotErrorClass(error)).toBe("other");
		expect(copilotErrorClass(new TypeError("private"))).toBe("TypeError");
	});

	it("sends immediately, repeats while open and stops on completion", () => {
		vi.useFakeTimers();
		const send = vi.fn(() => true);
		const stop = startCopilotHeartbeats(send);
		expect(send).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(10_000);
		expect(send).toHaveBeenCalledTimes(3);
		stop();
		vi.advanceTimersByTime(10_000);
		expect(send).toHaveBeenCalledTimes(3);
	});

	it("stops when the stream closes", () => {
		vi.useFakeTimers();
		const send = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
		startCopilotHeartbeats(send);
		vi.advanceTimersByTime(10_000);
		expect(send).toHaveBeenCalledTimes(2);
	});
});
