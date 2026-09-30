import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "@/server/auth";

export type SessionUser = { id: string; email: string; name: string };

export const fetchSession = createServerFn({ method: "GET" }).handler(
	async (): Promise<SessionUser | null> => {
		const headers = new Headers(getRequestHeaders() as HeadersInit);
		const session = await auth.api.getSession({ headers });
		if (!session?.user) return null;
		return {
			id: session.user.id,
			email: session.user.email,
			name: session.user.name,
		};
	},
);
