export class RequestTooLargeError extends Error {}

/**
 * `content-length` is absent on a chunked request, so a declared-size check
 * alone can be skipped and the whole body still buffered in memory. This caps
 * what is actually read, whatever the headers claim.
 */
export function withBodyLimit(request: Request, limitBytes: number): Request {
	if (!request.body) return request;
	let seen = 0;
	const limited = request.body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				seen += chunk.byteLength;
				if (seen > limitBytes)
					throw new RequestTooLargeError("Request body too large");
				controller.enqueue(chunk);
			},
		}),
	);
	return new Request(request.url, {
		method: request.method,
		headers: request.headers,
		body: limited,
		// Required when streaming a request body.
		duplex: "half",
	} as RequestInit & { duplex: "half" });
}

/** True when a thrown error is the body cap above, however it was wrapped. */
export function isRequestTooLarge(error: unknown): boolean {
	if (error instanceof RequestTooLargeError) return true;
	const cause = (error as { cause?: unknown })?.cause;
	return cause instanceof RequestTooLargeError;
}
