import { RPCHandler } from "@orpc/server/fetch";
import { createFileRoute } from "@tanstack/react-router";
import { createORPCContext } from "@/server/orpc/context";
import { router } from "@/server/orpc/router";

const handler = new RPCHandler(router);

async function handle({ request }: { request: Request }) {
	const context = await createORPCContext(request);
	const { response } = await handler.handle(request, {
		prefix: "/api/rpc",
		context,
	});
	const result = response ?? new Response("Nicht gefunden", { status: 404 });
	result.headers.set("x-request-id", context.requestId);
	return result;
}

export const Route = createFileRoute("/api/rpc/$")({
	server: {
		handlers: {
			GET: handle,
			POST: handle,
			PUT: handle,
			PATCH: handle,
			DELETE: handle,
		},
	},
});
