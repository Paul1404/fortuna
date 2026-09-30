import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	LIABILITY_SHEET_KEYS,
	LiabilitiesPanel,
	liabilitiesQueries,
} from "@/components/liabilities-sheet";
import { PageHeader } from "@/components/page-header";
import {
	ReceivablesPanel,
	receivablesQueries,
} from "@/components/receivables-sheet";
import { useFormat } from "@/lib/format";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";

/**
 * Forderungen & Schulden: what others owe the owner and what the owner owes,
 * as two tabs of one page instead of two menu entries. Each tab keeps its
 * sheet layout (sections, subtotals, click-to-edit values).
 */

type Tab = "receivables" | "liabilities";
type Search = { tab?: Tab; sheet?: string; highlight?: string };

export const Route = createFileRoute("/_app/debts")({
	validateSearch: (raw: Record<string, unknown>): Search => ({
		tab:
			raw.tab === "liabilities" || raw.tab === "receivables"
				? raw.tab
				: undefined,
		sheet:
			typeof raw.sheet === "string" &&
			raw.sheet !== "all" &&
			LIABILITY_SHEET_KEYS.includes(raw.sheet)
				? raw.sheet
				: undefined,
		highlight: typeof raw.highlight === "string" ? raw.highlight : undefined,
	}),
	loaderDeps: ({ search }) => ({ tab: search.tab ?? "receivables" }),
	loader: async ({ context, deps }) => {
		const queries =
			deps.tab === "liabilities" ? liabilitiesQueries() : receivablesQueries();
		await Promise.all([
			context.queryClient.ensureQueryData(orpc.settings.get.queryOptions()),
			...queries.map((query) =>
				context.queryClient.ensureQueryData(
					query as Parameters<typeof context.queryClient.ensureQueryData>[0],
				),
			),
		]);
	},
	head: () => ({ meta: [{ title: "Forderungen & Schulden · Fortuna" }] }),
	component: DebtsPage,
});

const TABS: { key: Tab; label: string }[] = [
	{ key: "receivables", label: "Forderungen" },
	{ key: "liabilities", label: "Verbindlichkeiten" },
];

function DebtsPage() {
	const { tab = "receivables", sheet, highlight } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const { data: nw } = useSuspenseQuery(orpc.netWorth.current.queryOptions());
	const f = useFormat();
	const totals: Record<Tab, number> = {
		receivables: nw.receivablesMinor,
		liabilities: -nw.totalLiabilitiesMinor,
	};
	return (
		<div className="space-y-5">
			<PageHeader title="Forderungen & Schulden" />
			<div
				role="tablist"
				aria-label="Forderungen und Schulden"
				className="flex flex-wrap gap-1 border-b border-border"
			>
				{TABS.map((entry) => (
					<button
						key={entry.key}
						type="button"
						role="tab"
						aria-selected={tab === entry.key}
						onClick={() =>
							navigate({
								search: entry.key === "receivables" ? {} : { tab: entry.key },
							})
						}
						className={cn(
							"-mb-px border-b-2 px-3 py-2 text-left outline-none focus-visible:outline-2 focus-visible:outline-focus",
							tab === entry.key
								? "border-brand text-text"
								: "border-transparent text-text-secondary hover:text-text",
						)}
					>
						<span className="block text-sm font-medium">{entry.label}</span>
						<span className="amount block text-[11px] text-text-muted">
							{f.money(totals[entry.key], nw.baseCurrency, { compact: true })}
						</span>
					</button>
				))}
			</div>
			{tab === "liabilities" ? (
				<LiabilitiesPanel
					highlight={highlight}
					sheet={sheet}
					onSheet={(next) =>
						navigate({
							search: { tab: "liabilities", ...(next ? { sheet: next } : {}) },
						})
					}
				/>
			) : (
				<ReceivablesPanel highlight={highlight} />
			)}
		</div>
	);
}
