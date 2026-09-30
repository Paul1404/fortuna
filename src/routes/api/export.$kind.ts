import { createFileRoute } from "@tanstack/react-router";
import { todayIso } from "@/domain/dates";
import { createORPCContext } from "@/server/orpc/context";
import {
	exportAssetsCsv,
	exportLiabilitiesCsv,
	exportNetWorthCsv,
	exportOptimizationsCsv,
	exportReceivablesCsv,
	exportTransactionsCsv,
} from "@/server/services/export";

const EXPORTS: Record<string, (userId: string) => Promise<string>> = {
	transactions: exportTransactionsCsv,
	assets: exportAssetsCsv,
	liabilities: exportLiabilitiesCsv,
	receivables: exportReceivablesCsv,
	"net-worth": exportNetWorthCsv,
	optimizations: exportOptimizationsCsv,
};

export const Route = createFileRoute("/api/export/$kind")({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const context = await createORPCContext(request);
				if (!context.user)
					return new Response("Nicht angemeldet", { status: 401 });
				// A plain object would also resolve "constructor" or "toString".
				const exporter = Object.hasOwn(EXPORTS, params.kind)
					? EXPORTS[params.kind]
					: undefined;
				if (!exporter) return new Response("Nicht gefunden", { status: 404 });
				const csv = await exporter(context.user.id);
				return new Response(csv, {
					headers: {
						"content-type": "text/csv; charset=utf-8",
						"content-disposition": `attachment; filename="fortuna-${params.kind}-${todayIso()}.csv"`,
						"cache-control": "no-store",
					},
				});
			},
		},
	},
});
