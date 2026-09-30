import { auth } from "@/server/auth";
import { requestIdFromHeaders } from "@/server/request-id";
import type { ORPCContext } from "./base";

export async function createORPCContext(
	request: Request,
): Promise<ORPCContext> {
	const requestId = requestIdFromHeaders(request.headers);
	const headers = new Headers(request.headers);
	headers.set("x-request-id", requestId);
	const session = await auth.api.getSession({
		headers,
		query: { disableCookieCache: true },
	});
	const user = session?.user
		? {
				id: session.user.id,
				email: session.user.email,
				name: session.user.name,
			}
		: null;
	return { user, headers, requestId, principal: "session" };
}
