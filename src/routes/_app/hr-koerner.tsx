import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { RecapSentences } from "@/components/desk-recap";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { addMonths, todayIso } from "@/domain/dates";
import { estimateMonthsToGoal } from "@/domain/hr-koerner";
import { germanMonthName } from "@/domain/monthly-recap";
import { Money, useFormat } from "@/lib/format";
import { reportError, useInvalidateAll } from "@/lib/forms";
import { orpc } from "@/lib/orpc";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const Route = createFileRoute("/_app/hr-koerner")({
	validateSearch: (raw: Record<string, unknown>): { recap?: string } => ({
		recap:
			typeof raw.recap === "string" && MONTH_PATTERN.test(raw.recap)
				? raw.recap
				: undefined,
	}),
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(
				orpc.hrKoerner.observations.queryOptions(),
			),
			context.queryClient.ensureQueryData(
				orpc.hrKoerner.weeklyReport.queryOptions(),
			),
			context.queryClient.ensureQueryData(
				orpc.hrKoerner.reviewHealth.queryOptions(),
			),
			context.queryClient.ensureQueryData(
				orpc.hrKoerner.profile.queryOptions(),
			),
		]),
	head: () => ({ meta: [{ title: "Erledigt und entschieden · Fortuna" }] }),
	component: KoernerPage,
});

const severityLabel = {
	info: "Hinweis",
	notable: "Auffällig",
	review: "Prüfen",
	urgent: "Dringend",
} as const;
const evidenceLabel: Record<string, string> = {
	cashMinor: "Liquide Mittel",
	reserveMinor: "Reserve",
	shortfallMinor: "Fehlbetrag",
	spentMinor: "Ausgabe",
	merchantMedianMinor: "Bisheriger Median",
	priorCount: "Frühere Buchungen",
	ratioBps: "Verhältnis",
	count: "Abos",
	monthlyMinor: "Pro Monat",
	annualMinor: "Pro Jahr",
	expectedAmountMinor: "Erwartete Zahlung",
	expectedDate: "Erwarteter Termin",
	cashAfterMinor: "Liquidität danach",
	ageDays: "Alter in Tagen",
	kind: "Datenart",
	fixedCostsBeforeMinor: "Fixkosten vorher, pro Monat",
	fixedCostsNowMinor: "Fixkosten jetzt, pro Monat",
	incomeBeforeMinor: "Einkommen vorher, pro Monat",
	incomeNowMinor: "Einkommen jetzt, pro Monat",
	fixedGrowthBps: "Veränderung Fixkosten",
	incomeGrowthBps: "Veränderung Einkommen",
	comparedWith: "Verglichen mit",
};
const evidenceValue: Record<string, string> = {
	year: "Vorjahresquartal",
	quarter: "Vorquartal",
};

type Observation = Awaited<
	ReturnType<typeof orpc.hrKoerner.observations.call>
>[number];

function Evidence({ observation }: { observation: Observation }) {
	const f = useFormat();
	return (
		<details className="mt-3 text-xs text-text-secondary">
			<summary className="cursor-pointer text-brand">
				Warum sehe ich das?
			</summary>
			<dl className="mt-2 grid gap-1 sm:grid-cols-2">
				{Object.entries(observation.evidence)
					.filter(([key]) => key !== "transactionId")
					.map(([key, value]) => (
						<div key={key} className="flex flex-wrap justify-between gap-2">
							<dt>{evidenceLabel[key] ?? key}</dt>
							<dd className="font-medium text-text">
								{typeof value === "number" &&
								key.endsWith("Minor") &&
								observation.currency
									? f.money(value, observation.currency)
									: key.endsWith("Bps") &&
											key !== "ratioBps" &&
											typeof value === "number"
										? `${value > 0 ? "+" : value < 0 ? "−" : ""}${f.number(Math.abs(value) / 100, 0)} %`
										: key === "ratioBps" && typeof value === "number"
											? `${f.number(value / 100, 0)} %`
											: value === null
												? "Nicht bekannt"
												: typeof value === "string" && evidenceValue[value]
													? evidenceValue[value]
													: String(value)}
							</dd>
						</div>
					))}
			</dl>
			<p className="mt-2 break-words">
				Zeitraum:{" "}
				{observation.periodStart ? f.date(observation.periodStart) : "offen"}{" "}
				bis {observation.periodEnd ? f.date(observation.periodEnd) : "heute"}.
				Quelle: Fortuna-Daten. Sicherheit:{" "}
				{observation.confidence === "high"
					? "hoch"
					: observation.confidence === "medium"
						? "mittel"
						: "gering"}
				.
			</p>
			{observation.sourceEntities.length ? (
				<p className="mt-1">
					Belege: {observation.sourceEntities.length} verknüpfte Datensätze.
				</p>
			) : null}
		</details>
	);
}

function KoernerPage() {
	const { data: observations } = useSuspenseQuery(
		orpc.hrKoerner.observations.queryOptions(),
	);
	const { data: report } = useSuspenseQuery(
		orpc.hrKoerner.weeklyReport.queryOptions(),
	);
	const { data: health } = useSuspenseQuery(
		orpc.hrKoerner.reviewHealth.queryOptions(),
	);
	const { data: profile } = useSuspenseQuery(
		orpc.hrKoerner.profile.queryOptions(),
	);
	const f = useFormat();
	const goalMonths =
		profile.currency === report.baseCurrency &&
		profile.targetNetWorthMinor !== null
			? estimateMonthsToGoal(
					profile.targetNetWorthMinor,
					report.netWorthMinor,
					profile.monthlySavingsTargetMinor,
				)
			: null;
	const invalidate = useInvalidateAll();
	const review = useMutation(
		orpc.hrKoerner.reviewNow.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Finanzen geprüft");
			},
			onError: reportError,
		}),
	);
	const update = useMutation(
		orpc.hrKoerner.updateObservation.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Hinweis aktualisiert");
			},
			onError: reportError,
		}),
	);
	const open = observations.filter((row) => row.status === "open");
	const snoozed = observations.filter((row) => row.status === "snoozed");
	const closed = observations.filter(
		(row) =>
			row.status === "resolved" ||
			row.status === "dismissed" ||
			row.status === "intentional",
	);
	const renderCard = (row: Observation) => (
		<Card key={row.id}>
			<CardBody className="pt-4">
				<div className="flex flex-wrap items-start justify-between gap-2">
					<div className="min-w-0">
						<div className="flex flex-wrap items-center gap-2">
							<h3 className="text-sm font-semibold text-text">{row.title}</h3>
							<Badge
								variant={
									row.severity === "urgent"
										? "negative"
										: row.severity === "review"
											? "warning"
											: "info"
								}
							>
								{severityLabel[row.severity]}
							</Badge>
						</div>
						<p className="mt-1 text-sm text-text-secondary">
							{row.explanation}
						</p>
						{row.impactMinor !== null && row.currency ? (
							<p className="mt-2 text-sm">
								Finanzieller Kontext:{" "}
								<Money amountMinor={row.impactMinor} currency={row.currency} />
								{row.type === "repeated_small_leak"
									? " pro Jahr, keine behauptete Ersparnis"
									: row.type === "lifestyle_creep"
										? " mehr Fixkosten im Monat"
										: ""}
							</p>
						) : null}
					</div>
				</div>
				<Evidence observation={row} />
				{row.status === "open" ? (
					<div className="mt-3 flex flex-wrap gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={update.isPending}
							onClick={() =>
								update.mutate({ id: row.id, status: "intentional" })
							}
						>
							Absichtlich
						</Button>
						<Button
							variant="ghost"
							size="sm"
							disabled={update.isPending}
							onClick={() =>
								update.mutate({
									id: row.id,
									status: "snoozed",
									snoozedUntil: new Date(Date.now() + 7 * 86_400_000),
								})
							}
						>
							7 Tage pausieren
						</Button>
						<Button
							variant="ghost"
							size="sm"
							disabled={update.isPending}
							onClick={() => update.mutate({ id: row.id, status: "dismissed" })}
						>
							Ausblenden
						</Button>
					</div>
				) : row.status !== "resolved" ? (
					<Button
						className="mt-3"
						variant="ghost"
						size="sm"
						disabled={update.isPending}
						onClick={() => update.mutate({ id: row.id, status: "open" })}
					>
						Wieder anzeigen
					</Button>
				) : null}
			</CardBody>
		</Card>
	);

	return (
		<div className="space-y-5">
			<PageHeader
				title="Erledigt und entschieden"
				subtitle="Was Hr. Körner festgestellt hat und wie Sie entschieden haben"
				actions={
					<>
						<Button
							variant="outline"
							disabled={review.isPending}
							onClick={() => review.mutate(undefined)}
						>
							{review.isPending ? "Prüfe ..." : "Jetzt prüfen"}
						</Button>
						<Button asChild>
							<Link to="/">Zum Schreibtisch</Link>
						</Button>
					</>
				}
			/>
			<p className="text-xs text-text-muted">
				Letzte Prüfung:{" "}
				{health?.lastSucceededAt
					? f.dateTime(health.lastSucceededAt)
					: "noch keine"}
				{health?.lastErrorClass ? " · Prüfung fehlgeschlagen" : ""}
			</p>
			<section className="space-y-3">
				<h2 className="font-display text-xl">
					Erledigt und bewusst entschieden ({closed.length})
				</h2>
				{closed.length ? (
					closed.map(renderCard)
				) : (
					<p className="text-sm text-text-muted">Noch nichts entschieden.</p>
				)}
			</section>
			<section className="space-y-3">
				<h2 className="font-display text-xl">Pausiert ({snoozed.length})</h2>
				{snoozed.length ? (
					snoozed.map(renderCard)
				) : (
					<p className="text-sm text-text-muted">Nichts pausiert.</p>
				)}
			</section>
			{/* Open findings are worked on the desk; they stay listed here so
			    nothing depends on which of them the desk turns into a task. */}
			<details className="space-y-3">
				<summary className="cursor-pointer text-sm font-semibold">
					Noch offen ({open.length})
				</summary>
				<div className="mt-3 space-y-3">{open.map(renderCard)}</div>
			</details>
			<RecapHistory />
			{profile.weeklyReportEnabled ? (
				<Card>
					<CardHeader
						title="Wochenbericht"
						subtitle={`Stand ${f.date(report.asOf)}`}
					/>
					<CardBody className="grid gap-3 sm:grid-cols-3">
						<div>
							<p className="text-xs text-text-muted">Nettovermögen</p>
							<Money
								amountMinor={report.netWorthMinor}
								currency={report.baseCurrency}
							/>
						</div>
						<div>
							<p className="text-xs text-text-muted">Änderung zur Vorwoche</p>
							{report.netWorthChangeMinor === null ? (
								<span className="text-sm text-text-muted">
									Keine Vergleichsbasis
								</span>
							) : (
								<Money
									amountMinor={report.netWorthChangeMinor}
									currency={report.baseCurrency}
									signed
								/>
							)}
						</div>
						<div>
							<p className="text-xs text-text-muted">Liquide Mittel</p>
							<Money
								amountMinor={report.cashMinor}
								currency={report.baseCurrency}
							/>
						</div>
						<div>
							<p className="text-xs text-text-muted">
								Zahlungsfluss, letzte 7 Tage
							</p>
							<Money
								amountMinor={report.weeklyNetMinor}
								currency={report.baseCurrency}
								signed
							/>
						</div>
						<p className="text-xs text-text-secondary sm:col-span-3">
							{report.observationCount} offene Hinweise · die Wochenveränderung
							ist keine Rendite.
						</p>
					</CardBody>
				</Card>
			) : null}
			{profile.targetNetWorthMinor !== null ? (
				<Card>
					<CardHeader
						title="Vermögensziel"
						subtitle={
							profile.targetNetWorthDate
								? `Zieltermin ${f.date(profile.targetNetWorthDate)}`
								: "Noch ohne Zieltermin"
						}
					/>
					<CardBody className="grid gap-3 sm:grid-cols-3">
						<div>
							<p className="text-xs text-text-muted">Zielwert</p>
							<Money
								amountMinor={profile.targetNetWorthMinor}
								currency={profile.currency}
							/>
						</div>
						{profile.currency === report.baseCurrency ? (
							<div>
								<p className="text-xs text-text-muted">Noch bis zum Ziel</p>
								<Money
									amountMinor={Math.max(
										0,
										profile.targetNetWorthMinor - report.netWorthMinor,
									)}
									currency={profile.currency}
								/>
							</div>
						) : (
							<p className="text-sm text-warning sm:col-span-2">
								Basiswährung geändert. Bitte Finanzregeln neu eingeben, bevor
								Werte verglichen werden.
							</p>
						)}
						{goalMonths !== null ? (
							<div>
								<p className="text-xs text-text-muted">
									Rechnerisch bei gleicher Sparrate
								</p>
								<p className="text-sm font-medium">{goalMonths} Monate</p>
							</div>
						) : null}
						<p className="text-xs text-text-secondary sm:col-span-3">
							Lineare Sparratenrechnung ohne Rendite, Steuern und
							Wertänderungen.
						</p>
					</CardBody>
				</Card>
			) : null}
			<Card>
				<CardHeader
					title="Finanzregeln"
					subtitle="Ziele und Warnschwellen bestimmen, worauf ich achte."
				/>
				<CardBody>
					<Button asChild variant="outline">
						<Link to="/settings/hr-koerner">Regeln bearbeiten</Link>
					</Button>
				</CardBody>
			</Card>
		</div>
	);
}

/**
 * Every past month recap, the one the desk showed included: the desk card
 * leaves after "Gelesen", the recap does not.
 */
function RecapHistory() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const today = todayIso();
	const months = Array.from({ length: 12 }, (_, index) =>
		addMonths(`${today.slice(0, 7)}-01`, -(index + 1)).slice(0, 7),
	);
	const month =
		search.recap && months.includes(search.recap) ? search.recap : months[0];
	const {
		data: recap,
		isPending,
		isError,
	} = useQuery(orpc.desk.recapFor.queryOptions({ input: { month } }));
	return (
		<Card id="rueckblicke">
			<CardHeader
				title="Monatsrückblicke"
				action={
					<NativeSelect
						aria-label="Monat wählen"
						value={month}
						className="w-auto"
						onChange={(event) => {
							const { value } = event.currentTarget;
							navigate({ search: { recap: value }, replace: true });
						}}
					>
						{months.map((key) => (
							<option key={key} value={key}>
								{germanMonthName(key)} {key.slice(0, 4)}
							</option>
						))}
					</NativeSelect>
				}
			/>
			<CardBody>
				{recap ? (
					<RecapSentences recap={recap} />
				) : isError ? (
					<p className="text-sm text-text-muted">
						Der Rückblick ließ sich nicht laden.
					</p>
				) : isPending ? (
					<p className="text-sm text-text-muted">Lade ...</p>
				) : null}
			</CardBody>
		</Card>
	);
}
