import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BarChart } from "@/components/charts/bar-chart";
import { BarList } from "@/components/charts/bar-list";
import { LineChart } from "@/components/charts/line-chart";
import { PageHeader } from "@/components/page-header";
import { StatRow, StatTile } from "@/components/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableFooter,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { endOfMonth, monthLabel } from "@/domain/dates";
import { percentChange } from "@/domain/money";
import { Delta, Money, useFormat } from "@/lib/format";
import { orpc } from "@/lib/orpc";

type Search = { months?: number; horizon?: number };

/** Why a contract could not be turned into a future payment. */
const CONTRACT_GAP_LABELS: Record<string, string> = {
	no_cost: "keine Kosten hinterlegt",
	no_cadence: "kein Turnus",
	custom_cadence: "Turnus „individuell“",
	no_start: "kein Vertragsbeginn",
};

export const Route = createFileRoute("/_app/cashflow")({
	validateSearch: (raw: Record<string, unknown>): Search => ({
		months: [3, 6, 12, 24].includes(Number(raw.months))
			? Number(raw.months)
			: undefined,
		horizon: [30, 90, 180, 365].includes(Number(raw.horizon))
			? Number(raw.horizon)
			: undefined,
	}),
	loaderDeps: ({ search }) => search,
	loader: async ({ context, deps }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(
				orpc.cashflow.report.queryOptions({
					input: { months: deps.months ?? 12 },
				}),
			),
			context.queryClient.ensureQueryData(
				orpc.cashflow.forecast.queryOptions({
					input: { horizonDays: deps.horizon ?? 90 },
				}),
			),
		]);
	},
	head: () => ({ meta: [{ title: "Zahlungsfluss · Fortuna" }] }),
	component: CashflowPage,
});

function CashflowPage() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const months = search.months ?? 12;
	const horizon = search.horizon ?? 90;
	const { data: report } = useSuspenseQuery(
		orpc.cashflow.report.queryOptions({ input: { months } }),
	);
	const { data: forecast } = useSuspenseQuery(
		orpc.cashflow.forecast.queryOptions({ input: { horizonDays: horizon } }),
	);
	const f = useFormat();
	const groups = report.months.map((m) => ({
		x: m.month,
		label: monthLabel(m.month, f.locale).replace(" 20", " '"),
		values: [
			{ key: "income", value: m.incomeMinor },
			{ key: "expense", value: -m.expenseMinor },
		],
	}));
	const prevByCat = new Map(
		report.previousCategories.map((c) => [c.categoryId, c.amountMinor]),
	);
	// Comparing against a window in which barely anything was recorded produces
	// percentages that look like a spending crisis and mean nothing.
	const comparable =
		report.previousCoverage.monthsWithData >=
		Math.max(1, Math.ceil(report.previousCoverage.months / 2));
	const comparisonNote = comparable
		? null
		: report.previousCoverage.monthsWithData === 0
			? "Für den Zeitraum davor sind keine Buchungen erfasst, ein Vergleich ist deshalb nicht möglich."
			: `Der Zeitraum davor ist nur zu ${report.previousCoverage.monthsWithData} von ${report.previousCoverage.months} Monaten erfasst — Vergleichswerte wären irreführend.`;

	return (
		<div className="space-y-5">
			<PageHeader
				title="Zahlungsfluss"
				subtitle={`${f.date(report.from, "month")} bis ${f.date(report.to, "month")} · ohne interne Umbuchungen · ${report.baseCurrency}`}
				actions={
					<NativeSelect
						aria-label="Zeitraum"
						value={months}
						onChange={(e) =>
							navigate({
								search: (p) => ({ ...p, months: Number(e.target.value) }),
							})
						}
						className="w-full sm:w-44"
					>
						<option value={3}>Letzte 3 Monate</option>
						<option value={6}>Letzte 6 Monate</option>
						<option value={12}>Letzte 12 Monate</option>
						<option value={24}>Letzte 24 Monate</option>
					</NativeSelect>
				}
			/>
			{report.unconverted.length ? (
				<p className="rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning">
					Transaktionen in {report.unconverted.join(", ")} fehlen, weil kein
					Wechselkurs hinterlegt ist.
				</p>
			) : null}
			<StatRow className="xl:grid-cols-4">
				<StatTile
					label="Einnahmen"
					value={
						<Money
							amountMinor={report.totals.incomeMinor}
							tone="positive"
							className="text-[22px]"
						/>
					}
					detail={
						comparable ? (
							<Delta
								amountMinor={
									report.totals.incomeMinor - report.previous.incomeMinor
								}
								pct={percentChange(
									report.previous.incomeMinor,
									report.totals.incomeMinor,
								)}
							/>
						) : (
							<span className="text-text-muted">kein Vergleichszeitraum</span>
						)
					}
				/>
				<StatTile
					label="Ausgaben"
					value={
						<Money
							amountMinor={report.totals.expenseMinor}
							className="text-[22px]"
						/>
					}
					detail={
						comparable ? (
							<Delta
								amountMinor={
									report.totals.expenseMinor - report.previous.expenseMinor
								}
								pct={percentChange(
									report.previous.expenseMinor,
									report.totals.expenseMinor,
								)}
							/>
						) : (
							<span className="text-text-muted">kein Vergleichszeitraum</span>
						)
					}
				/>
				<StatTile
					label="Überschuss"
					value={
						<Money
							amountMinor={report.totals.netMinor}
							tone="auto"
							signed
							className="text-[22px]"
						/>
					}
					detail={
						<span className="text-text-muted">
							Sparquote{" "}
							{report.totals.savingsRate === null
								? "—"
								: f.percent(report.totals.savingsRate * 100).replace("+", "")}
						</span>
					}
				/>
				<StatTile
					label="Monatlicher Durchschnitt"
					value={
						<Money
							amountMinor={report.averages.netMinor}
							tone="auto"
							signed
							className="text-[22px]"
						/>
					}
					detail={
						<span className="text-text-muted">
							Einnahmen{" "}
							{f.money(report.averages.incomeMinor, undefined, {
								compact: true,
							})}{" "}
							· Ausgaben{" "}
							{f.money(report.averages.expenseMinor, undefined, {
								compact: true,
							})}
						</span>
					}
				/>
			</StatRow>
			<div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
				<Card>
					<CardHeader
						title="Einnahmen und Ausgaben"
						subtitle="Balken je Monat, Linie als gleitender 3-Monats-Saldo"
					/>
					<CardBody>
						<BarChart
							ariaLabel="Monatliche Einnahmen und Ausgaben"
							groups={groups}
							series={[
								{
									key: "income",
									label: "Einnahmen",
									color: "var(--fortuna-chart-2)",
								},
								{
									key: "expense",
									label: "Ausgaben",
									color: "var(--fortuna-chart-neutral-3)",
								},
							]}
							line={{
								label: "Gleitender Saldo (3 Monate)",
								values: report.rolling3.map((m) => ({
									x: m.month,
									y: m.netMinor,
								})),
							}}
							height={260}
						/>
					</CardBody>
				</Card>
				<Card>
					<CardHeader
						title="Ausgaben nach Kategorie"
						subtitle={
							comparisonNote ??
							`im Vergleich zu den vorherigen ${months} Monaten`
						}
					/>
					<CardBody>
						<BarList
							items={report.categories.slice(0, 10).map((c) => {
								const prev = prevByCat.get(c.categoryId) ?? 0;
								const pct = percentChange(prev, c.amountMinor);
								return {
									key: c.categoryId ?? "none",
									label: c.name,
									amountMinor: c.amountMinor,
									secondary: !comparable
										? ""
										: pct === null
											? "erstmals"
											: f.percent(pct),
									href: "/transactions",
									search: c.categoryId
										? {
												categoryId: c.categoryId,
												from: report.from,
												to: report.to,
											}
										: { uncategorised: true, from: report.from, to: report.to },
								};
							})}
						/>
					</CardBody>
				</Card>
			</div>
			<Card>
				<CardHeader title="Monatsdetails" />
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Monat</TableHead>
							<TableHead className="hidden text-right sm:table-cell">
								Einnahmen
							</TableHead>
							<TableHead className="hidden text-right sm:table-cell">
								Ausgaben
							</TableHead>
							<TableHead className="text-right">Saldo</TableHead>
							<TableHead className="hidden text-right sm:table-cell">
								Sparquote
							</TableHead>
							<TableHead className="hidden text-right md:table-cell">
								Gleitender Saldo (3 Monate)
							</TableHead>
							<TableHead className="hidden text-right md:table-cell">
								Transaktionen
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{report.months.map((m, i) => (
							<TableRow key={m.month}>
								<TableCell className="max-sm:[&>span]:text-left">
									<Link
										to="/transactions"
										search={{
											from: `${m.month}-01`,
											to: endOfMonth(`${m.month}-01`),
											transfers: "hide",
										}}
										className="hover:underline"
									>
										{monthLabel(m.month, f.locale)}
									</Link>
									<span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] sm:hidden">
										<Money
											amountMinor={m.incomeMinor}
											tone="positive"
											weight="normal"
										/>
										<Money amountMinor={-m.expenseMinor} weight="normal" />
									</span>
								</TableCell>
								<TableCell className="hidden text-right sm:table-cell">
									<Money
										amountMinor={m.incomeMinor}
										tone="positive"
										weight="medium"
									/>
								</TableCell>
								<TableCell className="hidden text-right sm:table-cell">
									<Money amountMinor={-m.expenseMinor} weight="medium" />
								</TableCell>
								<TableCell className="text-right">
									<Money amountMinor={m.netMinor} tone="auto" signed />
								</TableCell>
								<TableCell className="hidden text-right text-text-secondary sm:table-cell">
									{m.incomeMinor > 0
										? f
												.percent(
													((m.incomeMinor - m.expenseMinor) / m.incomeMinor) *
														100,
												)
												.replace("+", "")
										: "—"}
								</TableCell>
								<TableCell className="hidden text-right md:table-cell">
									<Money
										amountMinor={report.rolling3[i]?.netMinor ?? 0}
										tone="muted"
										weight="medium"
									/>
								</TableCell>
								<TableCell className="hidden text-right text-text-secondary md:table-cell">
									{m.transactionCount}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
					<TableFooter>
						<TableRow>
							<TableCell className="max-sm:[&>span]:text-left">
								Summe
								<span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] font-normal sm:hidden">
									<Money
										amountMinor={report.totals.incomeMinor}
										tone="positive"
										weight="normal"
									/>
									<Money
										amountMinor={-report.totals.expenseMinor}
										weight="normal"
									/>
								</span>
							</TableCell>
							<TableCell className="hidden text-right sm:table-cell">
								<Money
									amountMinor={report.totals.incomeMinor}
									tone="positive"
								/>
							</TableCell>
							<TableCell className="hidden text-right sm:table-cell">
								<Money amountMinor={-report.totals.expenseMinor} />
							</TableCell>
							<TableCell className="text-right">
								<Money
									amountMinor={report.totals.netMinor}
									tone="auto"
									signed
								/>
							</TableCell>
							<TableCell className="hidden sm:table-cell" />
							<TableCell className="hidden md:table-cell" />
							<TableCell className="hidden text-right text-text-secondary md:table-cell">
								{report.months.reduce((s, m) => s + m.transactionCount, 0)}
							</TableCell>
						</TableRow>
					</TableFooter>
				</Table>
			</Card>

			<Card>
				<CardHeader
					title="Prognose"
					subtitle={`Heute ${f.money(forecast.openingBalanceMinor)} · durchgezogen: geplante Zahlungen · gestrichelt: mit wiederkehrenden Schätzwerten · Band: unregelmäßige Ausgaben`}
					action={
						<NativeSelect
							aria-label="Prognosezeitraum"
							value={horizon}
							onChange={(e) =>
								navigate({
									search: (p) => ({ ...p, horizon: Number(e.target.value) }),
								})
							}
							className="w-auto min-w-28"
						>
							<option value={30}>30 Tage</option>
							<option value={90}>90 Tage</option>
							<option value={180}>180 Tage</option>
							<option value={365}>1 Jahr</option>
						</NativeSelect>
					}
				/>
				<CardBody className="space-y-4">
					<div className="grid gap-3 sm:grid-cols-4">
						<div>
							<p className="label-caps">Geplante Zahlungen</p>
							<Money
								amountMinor={forecast.scheduledNetMinor}
								tone="auto"
								signed
								className="mt-1 block text-sm"
							/>
							<p className="text-[11px] text-text-muted">
								{forecast.assumptions.scheduledCount} ausstehende Transaktionen
								· sicher
							</p>
						</div>
						<div>
							<p className="label-caps">Wiederkehrende Schätzung</p>
							<Money
								amountMinor={forecast.recurringNetMinor}
								tone="auto"
								signed
								className="mt-1 block text-sm"
							/>
							<p className="text-[11px] text-text-muted">
								{forecast.assumptions.recurringCount} laufende Zahlungen
								{forecast.assumptions.contractCount > 0
									? ` · ${forecast.assumptions.contractCount} aus Verträgen`
									: ""}{" "}
								· geschätzt
							</p>
						</div>
						{forecast.assumptions.contractGaps.length ? (
							<p className="col-span-full text-[11px] text-warning">
								{/* A contract missing a start date or a cadence cannot be
								    projected. Saying so beats leaving it out in silence. */}
								Nicht eingerechnet, weil Angaben fehlen:{" "}
								{forecast.assumptions.contractGaps
									.map(
										(gap) =>
											`${gap.name} (${CONTRACT_GAP_LABELS[gap.reason] ?? "unvollständig"})`,
									)
									.join(", ")}
								.
							</p>
						) : null}
						{forecast.unconverted.length ? (
							<p className="col-span-full text-[11px] text-warning">
								Nicht eingerechnet, weil kein Wechselkurs hinterlegt ist:{" "}
								{forecast.unconverted.join(", ")}.
							</p>
						) : null}
						<div>
							<p className="label-caps">Unregelmäßige Ausgaben</p>
							<Money
								amountMinor={forecast.irregularNetMinor}
								tone="auto"
								signed
								className="mt-1 block text-sm"
							/>
							<p className="text-[11px] text-text-muted">
								{f.money(forecast.assumptions.irregularDailyNetMinor)} pro Tag
								aus dem Verlauf · unsicher
							</p>
						</div>
						<div>
							<p className="label-caps">Voraussichtlicher Endstand</p>
							<Money
								amountMinor={forecast.endBalanceMinor}
								tone="accent"
								className="mt-1 block text-sm"
							/>
							<p className="text-[11px] text-text-muted">
								Spanne{" "}
								{f.money(
									forecast.points[forecast.points.length - 1]?.lowMinor ?? 0,
									undefined,
									{ compact: true },
								)}{" "}
								–{" "}
								{f.money(
									forecast.points[forecast.points.length - 1]?.highMinor ?? 0,
									undefined,
									{ compact: true },
								)}
							</p>
						</div>
					</div>
					<LineChart
						ariaLabel="Zahlungsflussprognose"
						series={[
							{
								key: "sched",
								label: "Nur geplant",
								points: forecast.points.map((p) => ({
									x: p.date,
									y: p.scheduledOnlyMinor,
								})),
								color: "var(--fortuna-chart-1)",
							},
							{
								key: "rec",
								label: "Mit wiederkehrenden Zahlungen",
								points: forecast.points.map((p) => ({
									x: p.date,
									y: p.withRecurringMinor,
								})),
								color: "var(--fortuna-chart-3)",
								dashed: true,
							},
							{
								key: "proj",
								label: "Prognose",
								points: forecast.points.map((p) => ({
									x: p.date,
									y: p.projectedMinor,
								})),
								color: "var(--fortuna-accent)",
								dashed: true,
							},
						]}
						band={forecast.points.map((p) => ({
							x: p.date,
							low: p.lowMinor,
							high: p.highMinor,
						}))}
						height={260}
					/>
					{forecast.lowestPoint ? (
						<p className="text-xs text-text-secondary">
							Niedrigster prognostizierter Kontostand{" "}
							<Money
								amountMinor={forecast.lowestPoint.projectedMinor}
								className="text-xs"
							/>{" "}
							am {f.date(forecast.lowestPoint.date)}.
						</p>
					) : null}
					<details>
						<summary className="cursor-pointer text-xs font-medium text-text-secondary">
							Anstehende Zahlungen im Zeitraum ({forecast.events.length})
						</summary>
						<ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto text-xs">
							{forecast.events.map((e, i) => (
								<li
									key={`${e.sourceId}-${e.date}-${i}`}
									className="flex items-center justify-between gap-3 py-1.5"
								>
									<span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
										<span className="font-mono text-text-muted">
											{f.date(e.date, "short")}
										</span>
										<span className="min-w-0 break-words">{e.name}</span>
										<Badge variant={e.kind === "scheduled" ? "info" : "accent"}>
											{e.kind === "scheduled" ? "geplant" : "wiederkehrend"}
										</Badge>
									</span>
									<Money
										amountMinor={e.amountMinor}
										tone="auto"
										signed
										className="shrink-0 text-xs"
									/>
								</li>
							))}
						</ul>
					</details>
				</CardBody>
			</Card>
		</div>
	);
}
