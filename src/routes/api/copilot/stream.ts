import { createFileRoute } from "@tanstack/react-router";
import * as v from "valibot";
import { CopilotAskInput } from "@/lib/schemas";
import {
	copilotErrorClass,
	copilotTraceId,
	startCopilotHeartbeats,
} from "@/server/copilot-diagnostics";
import { logger } from "@/server/logger";
import { createORPCContext } from "@/server/orpc/context";
import { validateSameOriginRequest } from "@/server/same-origin";
import {
	type CopilotStreamEvent,
	streamCopilot,
} from "@/server/services/copilot";

export const Route = createFileRoute("/api/copilot/stream")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const boundaryError = validateSameOriginRequest(request, {
					baseUrl: process.env.BETTER_AUTH_URL,
					nodeEnv: process.env.NODE_ENV,
				});
				if (boundaryError) return boundaryError;
				const context = await createORPCContext(request);
				if (!context.user)
					return new Response("Nicht angemeldet", { status: 401 });
				const user = context.user;
				let input: v.InferOutput<typeof CopilotAskInput>;
				try {
					input = v.parse(CopilotAskInput, await request.json());
				} catch {
					return new Response("Ungültige Copilot-Anfrage", { status: 400 });
				}
				const traceId = copilotTraceId(
					request.headers.get("x-copilot-trace-id"),
				);
				const startedAt = performance.now();
				const elapsedMs = () => Math.round(performance.now() - startedAt);
				let firstChunkMs: number | null = null;
				let firstContentChunkMs: number | null = null;
				let chunksQueued = 0;
				let heartbeatsQueued = 0;
				let bytesQueued = 0;
				let lastEventType: CopilotStreamEvent["type"] | null = null;
				let streamOutcome = "completed";
				let finished = false;
				let stopHeartbeats: (() => void) | null = null;
				const finish = (outcome: string) => {
					if (finished) return;
					finished = true;
					stopHeartbeats?.();
					request.signal.removeEventListener("abort", onRequestAbort);
					logger.info("Fortuna Copilot stream finished", {
						event: "copilot.http.finished",
						traceId,
						outcome,
						elapsedMs: elapsedMs(),
						firstChunkMs,
						firstContentChunkMs,
						chunksQueued,
						heartbeatsQueued,
						bytesQueued,
						lastEventType,
					});
				};
				const encoder = new TextEncoder();
				const abort = new AbortController();
				const onRequestAbort = () => {
					logger.warn("Fortuna Copilot request aborted", {
						event: "copilot.http.request_aborted",
						traceId,
						elapsedMs: elapsedMs(),
						firstChunkMs,
					});
					abort.abort();
				};
				request.signal.addEventListener("abort", onRequestAbort, {
					once: true,
				});
				if (request.signal.aborted) onRequestAbort();
				logger.info("Fortuna Copilot stream opened", {
					event: "copilot.http.opened",
					traceId,
				});
				let closed = false;
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						const send = (event: CopilotStreamEvent) => {
							if (closed) return false;
							try {
								const chunk = encoder.encode(`${JSON.stringify(event)}\n`);
								controller.enqueue(chunk);
								chunksQueued += 1;
								if (event.type === "heartbeat") heartbeatsQueued += 1;
								bytesQueued += chunk.byteLength;
								lastEventType = event.type;
								if (firstChunkMs === null) {
									firstChunkMs = elapsedMs();
									logger.info("Fortuna Copilot first chunk queued", {
										event: "copilot.http.first_chunk",
										traceId,
										elapsedMs: firstChunkMs,
										eventType: event.type,
									});
								}
								if (
									event.type !== "heartbeat" &&
									firstContentChunkMs === null
								) {
									firstContentChunkMs = elapsedMs();
									logger.info("Fortuna Copilot first content chunk queued", {
										event: "copilot.http.first_content_chunk",
										traceId,
										elapsedMs: firstContentChunkMs,
										eventType: event.type,
									});
								}
								return true;
							} catch (error) {
								closed = true;
								abort.abort();
								logger.warn("Fortuna Copilot stream write failed", {
									event: "copilot.http.write_failed",
									traceId,
									errorClass: copilotErrorClass(error),
								});
								finish("write_failed");
								return false;
							}
						};
						// Flush response headers before the App Server's first token.
						stopHeartbeats = startCopilotHeartbeats(() =>
							send({ type: "heartbeat" }),
						);
						void streamCopilot(
							user.id,
							{ ...input, userName: user.name },
							send,
							abort.signal,
							traceId,
						)
							.catch((error) => {
								streamOutcome = abort.signal.aborted ? "aborted" : "failed";
								logger.warn("Fortuna Copilot stream task failed", {
									event: "copilot.http.task_failed",
									traceId,
									elapsedMs: elapsedMs(),
									errorClass: copilotErrorClass(error),
								});
							})
							.finally(() => {
								if (closed) return;
								closed = true;
								controller.close();
								finish(streamOutcome);
							});
					},
					cancel() {
						closed = true;
						abort.abort();
						finish("cancelled");
					},
				});
				return new Response(stream, {
					headers: {
						"content-type": "application/x-ndjson; charset=utf-8",
						"cache-control": "no-store, no-transform",
						"x-content-type-options": "nosniff",
						"x-copilot-trace-id": traceId,
					},
				});
			},
		},
	},
});
