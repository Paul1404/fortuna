import { ORPCError } from "@orpc/server";
import { createFileRoute } from "@tanstack/react-router";
import { createORPCContext } from "@/server/orpc/context";
import { getContractDocument } from "@/server/services/contracts";

export const Route = createFileRoute("/api/contracts/documents/$id")({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const context = await createORPCContext(request);
				if (!context.user)
					return new Response("Nicht angemeldet", { status: 401 });
				try {
					const document = await getContractDocument(
						context.user.id,
						params.id,
					);
					return new Response(Uint8Array.from(document.content).buffer, {
						headers: {
							"content-type": document.mimeType,
							"content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
							"cache-control": "private, no-store",
							"x-content-type-options": "nosniff",
						},
					});
				} catch (error) {
					if (error instanceof ORPCError && error.code === "NOT_FOUND")
						return new Response("Dokument nicht gefunden", { status: 404 });
					return new Response(
						"Dokumentspeicher vorübergehend nicht erreichbar",
						{
							status: 503,
						},
					);
				}
			},
		},
	},
});
