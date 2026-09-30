import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BookmarkPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BarList } from "@/components/charts/bar-list";
import { LineChart } from "@/components/charts/line-chart";
import { Sankey } from "@/components/charts/sankey";
import { NetWorthProgress } from "@/components/net-worth-progress";
import { PageHeader } from "@/components/page-header";
import { StatRow, StatTile } from "@/components/stat-tile";
import { TickingMoney } from "@/components/ticking-money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { percentChange } from "@/domain/money";
import { GROWTH_PERIODS, type GrowthPeriod } from "@/domain/progress";
import { Delta, Money, useFormat } from "@/lib/format";
import { indicativeNetWorth, useMarketPulse } from "@/lib/market-pulse";
import { orpc } from "@/lib/orpc";

/**
 * Vermögen: what the owner has, how it moved and where it sits. It absorbed
 * the former Übersicht (change by period, where the wealth lies) and
 * Rückblick (one metric over a chosen period), which showed the same
 * figures three times on three pages.
 */

type Metric = "net_worth" | "assets" | "investable" | "cash" | "liabilities";
type Interval = "monthly" | "quarterly" | "yearly";
type Mode = "totals" | "change";
type HistoryView = {
	metric: Metric;
	interval: Interval;
	months: number;
	mode: Mode;
};
type SavedView = HistoryView & { name: string };

const METRIC_LABELS: Record<Metric, string> = {
	net_worth: "Nettovermögen",
	assets: "Gesamtvermögen",
	investable: "Liquides Nettovermögen",
	cash: "Liquide Mittel",
	liabilities: "Verbindlichkeiten",
};
const METRICS = Object.keys(METRIC_LABELS) as Metric[];
const MONTH_CHOICES = [6, 12, 24, 60, 120];
const DEFAULT_VIEW: HistoryView = {
	metric: "net_worth",
	interval: "monthly",
	months: 24,
	mode: "totals",
};
// Six KPIs one under another filled two phone screens before the chart; two
// columns keep them on one, with figures that shrink to fit the column.
const KPI_ROW =
	"xl:grid-cols-6 max-[429px]:grid-cols-2 max-[429px]:[&>*]:px-3 max-[429px]:[&>*:nth-child(odd)]:border-r max-[429px]:[&>*:nth-child(odd)]:border-border";
const KPI_FIGURE = "text-[clamp(1rem,4.4vw,1.375rem)]";
// The key Rückblick saved its views under, so they survive the merge.
const VIEWS_KEY = "fortuna-recap-views-v1";

/** Search params stay optional so a bare `/net-worth` link needs none. */
type Search = Partial<HistoryView> & { growth?: GrowthPeriod };
const DEFAULT_GROWTH: GrowthPeriod = "year";

function historyView(search: Search): HistoryView {
	return {
		metric: search.metric ?? DEFAULT_VIEW.metric,
		interval: search.interval ?? DEFAULT_VIEW.interval,
		months: search.months ?? DEFAULT_VIEW.months,
		mode: search.mode ?? DEFAULT_VIEW.mode,
	};
}

export const Route = createFileRoute("/_app/net-worth")({
	validateSearch: (raw: Record<string, unknown>): Search => ({
		metric: METRICS.includes(raw.metric as Metric)
			? (raw.metric as Metric)
			: undefined,
		interval: ["monthly", "quarterly", "yearly"].includes(String(raw.interval))
			? (raw.interval as Interval)
			: undefined,
		months: MONTH_CHOICES.includes(Number(raw.months))
			? Number(raw.months)
			: undefined,
		mode: raw.mode === "change" || raw.mode === "totals" ? raw.mode : undefined,
		growth: GROWTH_PERIODS.includes(raw.growth as GrowthPeriod)
			? (raw.growth as GrowthPeriod)
			: undefined,
	}),
	loaderDeps: ({ search }) => ({
		view: historyView(search),
		growth: search.growth ?? DEFAULT_GROWTH,
	}),
	loader: async ({ context, deps }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(
				orpc.netWorth.progress.queryOptions({
					input: { period: deps.growth },
				}),
			),
			context.queryClient.ensureQueryData(orpc.netWorth.current.queryOptions()),
			context.queryClient.ensureQueryData(orpc.dashboard.queryOptions()),
			context.queryClient.ensureQueryData(
				orpc.insights.recap.queryOptions({ input: deps.view }),
			),
		]);
	},
	head: () => ({ meta: [{ title: "Vermögen · Fortuna" }] }),
	component: WealthPage,
});

function WealthPage() {
	const search = Route.useSearch();
	const view = historyView(search);
	const growth = search.growth ?? DEFAULT_GROWTH;
	const navigate = useNavigate({ from: Route.fullPath });
	const { data: nw } = useSuspenseQuery(orpc.netWorth.current.queryOptions());
	const { data: dashboard } = useSuspenseQuery(orpc.dashboard.queryOptions());
	const { data: recap } = useSuspenseQuery(
		orpc.insights.recap.queryOptions({ input: view }),
	);
	const { data: progress } = useSuspenseQuery(
		orpc.netWorth.progress.queryOptions({ input: { period: growth } }),
	);
	const { data: pulse } = useMarketPulse();
	const f = useFormat();
	const yearAgo = dashboard.history[0];
	const setView = (patch: Partial<HistoryView>) =>
		navigate({ search: { ...search, ...view, ...patch } });

	return (
		<div className="space-y-5">
			<PageHeader
				title="Vermögen"
				subtitle={`Gesamtvermögen abzüglich aller Verbindlichkeiten, ${f.date(nw.date)} · ${nw.baseCurrency}`}
				actions={
					<Button variant="outline" asChild>
						<a href="/api/export/net-worth" download>
							CSV exportieren
						</a>
					</Button>
				}
			/>
			{nw.unconvertedCurrencies.length ? (
				<p className="rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning">
					Positionen in {nw.unconvertedCurrencies.join(", ")} fehlen, weil kein
					Wechselkurs hinterlegt ist.{" "}
					<Link to="/settings" className="underline">
						Kurse hinzufügen
					</Link>
				</p>
			) : null}
			<StatRow className={KPI_ROW}>
				<StatTile
					label="Nettovermögen"
					value={
						<TickingMoney
							amountMinor={indicativeNetWorth(nw.netWorthMinor, pulse)}
							readingKey={pulse?.checkedAt}
							className={KPI_FIGURE}
						/>
					}
					detail={
						dashboard.change.yearMinor === null ? (
							<span className="text-text-muted">Noch kein Vergleichswert</span>
						) : (
							<Delta
								amountMinor={dashboard.change.yearMinor}
								pct={
									yearAgo
										? percentChange(yearAgo.netWorthMinor, nw.netWorthMinor)
										: null
								}
							/>
						)
					}
				/>
				<StatTile
					label="Liquides Nettovermögen"
					value={
						<Money
							amountMinor={nw.liquidNetWorthMinor}
							className={KPI_FIGURE}
							animate
						/>
					}
					detail={
						<span className="text-text-muted">
							liquide Mittel + Wertpapiere − Kartenschulden
						</span>
					}
				/>
				<StatTile
					label="Angelegt"
					value={
						<Money
							amountMinor={nw.investedMinor}
							className={KPI_FIGURE}
							animate
						/>
					}
					detail={
						<span className="text-text-muted">
							{nw.totalAssetsMinor > 0
								? f
										.percent((nw.investedMinor / nw.totalAssetsMinor) * 100)
										.replace("+", "")
								: "—"}{" "}
							des Vermögens
						</span>
					}
				/>
				<StatTile
					label="Sachwerte"
					value={
						<Money
							amountMinor={nw.physicalMinor}
							className={KPI_FIGURE}
							animate
						/>
					}
					detail={
						<Link to="/assets" className="text-brand hover:underline">
							Sachwerte öffnen
						</Link>
					}
				/>
				<StatTile
					label="Forderungen"
					value={
						<Money
							amountMinor={nw.receivablesMinor}
							className={KPI_FIGURE}
							animate
						/>
					}
					detail={<span className="text-text-muted">noch einzuziehen</span>}
				/>
				<StatTile
					label="Schulden"
					value={
						<Money
							amountMinor={-nw.totalLiabilitiesMinor}
							tone={nw.totalLiabilitiesMinor > 0 ? "negative" : "default"}
							className={KPI_FIGURE}
							animate
						/>
					}
					detail={
						<span className="text-text-muted">
							{nw.totalAssetsMinor > 0
								? f
										.percent(
											(nw.totalLiabilitiesMinor / nw.totalAssetsMinor) * 100,
										)
										.replace("+", "")
								: "—"}{" "}
							Schuldenquote
						</span>
					}
				/>
			</StatRow>

			<HistoryCard view={view} recap={recap} onChange={setView} />

			<NetWorthProgress
				progress={progress}
				onPeriod={(period) =>
					navigate({
						search: { ...search, growth: period },
						resetScroll: false,
					})
				}
			/>

			<PeriodChanges dashboard={dashboard} />

			{nw.providerBreakdown.length > 0 ? (
				<Card>
					<CardHeader
						title="Depot im Nettovermögen"
						subtitle="Depot und Guthaben zählen mit; Herkunft und Alter der Bewertung bleiben sichtbar"
					/>
					<CardBody className="space-y-3">
						{nw.providerBreakdown.map((source) => (
							<div
								key={source.accountId}
								className="grid gap-2 rounded-md border border-border p-3 text-sm sm:grid-cols-4"
							>
								<div>
									<p className="label-caps">Zusammen</p>
									<Money
										amountMinor={source.totalMinor}
										currency={nw.baseCurrency}
									/>
								</div>
								<div>
									<p className="label-caps">Wertpapiere</p>
									<Money
										amountMinor={source.investmentsMinor}
										currency={nw.baseCurrency}
									/>
								</div>
								<div>
									<p className="label-caps">Guthaben</p>
									<Money
										amountMinor={source.cashMinor}
										currency={nw.baseCurrency}
									/>
								</div>
								<div>
									<p className="label-caps">Bewertung</p>
									<Badge
										variant={
											source.confidence === "stale" ? "negative" : "default"
										}
									>
										{source.confidence === "stale" ? "veraltet" : "automatisch"}
									</Badge>
									<p className="mt-1 text-xs text-text-muted">
										{source.valuationAt
											? f.dateTime(source.valuationAt)
											: "ohne Zeitpunkt"}
									</p>
								</div>
								{source.unvaluedHoldings > 0 ? (
									<p className="text-warning sm:col-span-4">
										{source.unvaluedHoldings} Positionen ohne bewertbaren
										Betrag.
									</p>
								) : null}
								{source.unallocatedMinor !== 0 ? (
									<p className="text-text-muted sm:col-span-4">
										Differenz zur Anbieter-Depotbewertung:{" "}
										{f.money(source.unallocatedMinor, nw.baseCurrency)}. Der
										gemeldete Depotwert zählt.
									</p>
								) : null}
								<Link
									to="/depots/$id"
									params={{ id: source.accountId }}
									search={{ page: 1 }}
									className="text-link text-sm underline sm:col-span-4"
								>
									Positionen ansehen
								</Link>
							</div>
						))}
					</CardBody>
				</Card>
			) : null}

			<Holdings dashboard={dashboard} />
		</div>
	);
}

type Recap = Awaited<ReturnType<typeof orpc.insights.recap.call>>;
type Dashboard = Awaited<ReturnType<typeof orpc.dashboard.call>>;

function HistoryCard({
	view,
	recap,
	onChange,
}: {
	view: HistoryView;
	recap: Recap;
	onChange: (patch: Partial<HistoryView>) => void;
}) {
	const f = useFormat();
	const [views, setViews] = useState<SavedView[]>([]);
	const [viewName, setViewName] = useState("");
	useEffect(() => {
		try {
			const stored = JSON.parse(localStorage.getItem(VIEWS_KEY) ?? "[]");
			setViews(Array.isArray(stored) ? (stored as SavedView[]) : []);
		} catch {
			setViews([]);
		}
	}, []);
	const label = METRIC_LABELS[view.metric];
	const first = recap.points[0];
	const last = recap.points.at(-1);
	const delta =
		view.mode === "change"
			? recap.points.reduce((sum, point) => sum + point.valueMinor, 0)
			: first && last
				? last.valueMinor - first.valueMinor
				: 0;
	// Less debt is the good direction.
	const deltaTone = view.metric === "liabilities" ? -delta : delta;
	// Verbindlichkeiten are the one metric the depot does not touch.
	const deltaUnknown =
		recap.providerHistoryGap && view.metric !== "liabilities";
	const covered =
		recap.coveredFrom && recap.coveredMonths > 0
			? `seit ${f.date(recap.coveredFrom, "month")}`
			: null;

	return (
		<Card>
			<CardHeader
				title="Verlauf"
				subtitle={
					recap.maturity.chartReady
						? `${label} · ${view.mode === "totals" ? "Gesamtwerte" : "Veränderung je Zeitraum"}${covered ? ` · ${covered}` : ""}`
						: "Noch nicht genug Historie für einen belastbaren Verlauf"
				}
				action={
					<div className="text-right">
						<p className="label-caps">Veränderung</p>
						{deltaUnknown ? (
							<span className="text-sm text-text-muted">—</span>
						) : (
							<Money
								amountMinor={delta}
								signed
								tone={
									deltaTone < 0
										? "negative"
										: deltaTone > 0
											? "positive"
											: "default"
								}
								className="text-sm"
							/>
						)}
					</div>
				}
			/>
			<CardBody className="space-y-4">
				<div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
					<NativeSelect
						aria-label="Kennzahl"
						value={view.metric}
						onChange={(e) => onChange({ metric: e.target.value as Metric })}
					>
						{METRICS.map((metric) => (
							<option key={metric} value={metric}>
								{METRIC_LABELS[metric]}
							</option>
						))}
					</NativeSelect>
					<NativeSelect
						aria-label="Intervall"
						value={view.interval}
						onChange={(e) => onChange({ interval: e.target.value as Interval })}
					>
						<option value="monthly">Monatlich</option>
						<option value="quarterly">Quartalsweise</option>
						<option value="yearly">Jährlich</option>
					</NativeSelect>
					<NativeSelect
						aria-label="Zeitraum"
						value={view.months}
						onChange={(e) => onChange({ months: Number(e.target.value) })}
					>
						<option value={6}>6 Monate</option>
						<option value={12}>1 Jahr</option>
						<option value={24}>2 Jahre</option>
						<option value={60}>5 Jahre</option>
						<option value={120}>10 Jahre</option>
					</NativeSelect>
					<NativeSelect
						aria-label="Darstellung"
						value={view.mode}
						onChange={(e) => onChange({ mode: e.target.value as Mode })}
					>
						<option value="totals">Gesamtwerte</option>
						<option value="change">Veränderung je Zeitraum</option>
					</NativeSelect>
				</div>
				{recap.maturity.chartReady ? (
					<LineChart
						ariaLabel={`Verlauf ${label}`}
						series={[
							{
								key: view.metric,
								label,
								points: recap.points.map((point) => ({
									x: point.date,
									y: point.valueMinor,
								})),
								area: view.mode === "totals",
								color:
									view.metric === "liabilities"
										? "var(--fortuna-negative)"
										: undefined,
							},
						]}
						xLabel={(x) => f.date(x, "month")}
						height={280}
					/>
				) : (
					<p className="py-12 text-center text-sm text-text-muted">
						Der Verlauf erscheint nach sieben Tagen.
					</p>
				)}
				{deltaUnknown ? (
					<p className="text-xs text-text-muted">
						Das Depot zählt erst ab seinem ersten Abgleich; bis dahin gibt es
						dafür keinen Vergleichswert.
					</p>
				) : null}
				<div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
					{views.map((saved) => (
						<Button
							key={saved.name}
							variant="outline"
							size="sm"
							onClick={() =>
								onChange({
									metric: saved.metric,
									interval: saved.interval,
									months: saved.months,
									mode: saved.mode,
								})
							}
						>
							{saved.name}
						</Button>
					))}
					<Input
						value={viewName}
						onChange={(e) => setViewName(e.target.value)}
						placeholder="Ansicht benennen"
						aria-label="Name der Ansicht"
						className="w-44"
					/>
					<Button
						size="sm"
						variant="ghost"
						disabled={!viewName.trim()}
						onClick={() => {
							const name = viewName.trim();
							const next = [
								...views.filter((saved) => saved.name !== name),
								{ name, ...view },
							];
							try {
								localStorage.setItem(VIEWS_KEY, JSON.stringify(next));
							} catch {
								// Storage can be blocked; the view still applies now.
							}
							setViews(next);
							setViewName("");
							toast.success("Ansicht gespeichert");
						}}
					>
						<BookmarkPlus /> Speichern
					</Button>
				</div>
			</CardBody>
		</Card>
	);
}

function PeriodChanges({ dashboard }: { dashboard: Dashboard }) {
	const f = useFormat();
	const cell = (value: number | null, weight?: "medium") =>
		value === null ? (
			<span className="text-text-muted">—</span>
		) : (
			<Money amountMinor={value} tone="auto" signed weight={weight} />
		);
	return (
		<Card>
			<CardHeader title="Veränderung nach Zeitraum" />
			<div className="divide-y divide-border sm:hidden">
				{dashboard.deltas.map((d) => (
					<div
						key={d.label}
						className="flex min-w-0 items-center justify-between gap-3 px-4 py-2.5"
					>
						<div className="min-w-0">
							<p className="text-sm text-text-secondary">{d.label}</p>
							<p className="font-mono text-[10px] text-text-muted">
								{f.date(d.date, "short")}
							</p>
						</div>
						{cell(d.netWorthMinor)}
					</div>
				))}
			</div>
			<div className="hidden w-full overflow-x-auto overscroll-x-contain sm:block">
				<table className="w-full min-w-[680px] text-[13px]">
					<thead>
						<tr>
							<th className="label-caps px-4 py-2 text-left">Zeitraum</th>
							<th className="label-caps px-4 py-2 text-right">Nettovermögen</th>
							<th className="label-caps px-4 py-2 text-right">
								Liquides Nettovermögen
							</th>
							<th className="label-caps px-4 py-2 text-right">
								Gesamtvermögen
							</th>
							<th className="label-caps px-4 py-2 text-right">
								Verbindlichkeiten
							</th>
						</tr>
					</thead>
					<tbody>
						{dashboard.deltas.map((d) => (
							<tr key={d.label} className="border-t border-border">
								<td className="px-4 py-1.5 text-text-secondary">
									{d.label}
									<span className="ml-2 font-mono text-[10px] text-text-muted">
										{f.date(d.date, "short")}
									</span>
								</td>
								<td className="px-4 py-1.5 text-right">
									{cell(d.netWorthMinor)}
								</td>
								<td className="px-4 py-1.5 text-right">
									{cell(d.investableMinor, "medium")}
								</td>
								<td className="px-4 py-1.5 text-right">
									{cell(d.assetsMinor, "medium")}
								</td>
								<td className="px-4 py-1.5 text-right">
									{cell(
										d.liabilitiesMinor === null ? null : -d.liabilitiesMinor,
										"medium",
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{dashboard.providerHistoryGap ? (
				<p className="border-t border-border px-4 py-3 text-[13px] text-text-muted">
					Für das Depot gibt es Vergleichswerte erst ab dem ersten Abgleich; bis
					dahin bleiben die Zeiträume leer.
				</p>
			) : null}
		</Card>
	);
}

function Holdings({ dashboard }: { dashboard: Dashboard }) {
	const { holdings } = dashboard;
	const mobile = holdings.groups
		.map((group) => ({
			key: group.key,
			label: group.label,
			amountMinor: holdings.leaves
				.filter((leaf) => leaf.group === group.key)
				.reduce((sum, leaf) => sum + leaf.amountMinor, 0),
		}))
		.filter((group) => group.amountMinor !== 0);
	return (
		<Card>
			<CardHeader
				title="Wo das Vermögen liegt"
				subtitle="Alle Positionen nach Anlageklasse im Nettovermögen"
			/>
			<CardBody>
				<div className="sm:hidden">
					<BarList items={mobile} currency={dashboard.baseCurrency} />
				</div>
				<div className="hidden sm:block">
					<Sankey
						leaves={holdings.leaves}
						groups={holdings.groups}
						netWorthMinor={holdings.netWorthMinor}
						liabilitiesMinor={holdings.totalLiabilitiesMinor}
						height={Math.max(360, Math.min(720, holdings.leaves.length * 52))}
					/>
				</div>
			</CardBody>
		</Card>
	);
}
