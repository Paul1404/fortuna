import { describe, expect, it } from "vitest";
import { isRequestTooLarge, withBodyLimit } from "@/server/request-limits";

function chunkedRequest(chunks: readonly Uint8Array[]): Request {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk);
			controller.close();
		},
	});
	return new Request("https://fortuna.test/upload", {
		method: "POST",
		body,
		// A streamed body carries no content-length, which is the case the cap
		// exists for.
		duplex: "half",
	} as RequestInit & { duplex: "half" });
}

describe("request body limit", () => {
	it("passes a body that stays under the cap", async () => {
		const request = withBodyLimit(
			chunkedRequest([new Uint8Array(10), new Uint8Array(10)]),
			100,
		);
		expect((await request.arrayBuffer()).byteLength).toBe(20);
	});

	it("rejects a chunked body that exceeds the cap", async () => {
		const request = withBodyLimit(
			chunkedRequest([new Uint8Array(60), new Uint8Array(60)]),
			100,
		);
		await expect(request.arrayBuffer()).rejects.toSatisfy(isRequestTooLarge);
	});

	it("leaves a request without a body untouched", () => {
		const request = new Request("https://fortuna.test/upload");
		expect(withBodyLimit(request, 10)).toBe(request);
	});
});
