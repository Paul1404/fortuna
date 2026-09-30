import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { GrowthPeriod } from "@/domain/progress";
import { Money, useFormat } from "@/lib/format";
import type { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";

type Progress = Awaited<ReturnType<typeof orpc.netWorth.progress.call>>;

const PERIOD_LABELS: Record<GrowthPeriod, string> = {
	month: "Monat",
	last_month: "Vormonat",
	year: "Jahr",
};

/**
 * "Woher die Veränderung kommt": the change in net worth over a period split
 * into the owner's own saving, markets and valuations, and the rest, with
 * the savings streak beside it. Saving comes first because it is the part
 * the owner controls.
 */
export function NetWorthProgress({
	progress,
	onPeriod,
}: {
	progress: Progress;
	onPeriod: (period: GrowthPeriod) => void;
}) {
	const f = useFormat();
	const { growth, streak } = progress;
	const currency = progress.baseCurrency;
	const rows = growth
		? [
				{
					key: "saving",
					label: "Eigene Sparleistung",
					hint: "Einnahmen minus Ausgaben",
					amountMinor: growth.savingMinor,
				},
				{
					key: "market",
					label: "Markt & Bewertung",
					hint:
						growth.depot === "included"
							? "Depot über Einzahlungen hinaus, Sachwerte"
							: "Neubewertung der Sachwerte",
					amountMinor: growth.marketMinor,
				},
				{
					key: "other",
					label: "Sonstiges",
					hint: "Tilgung, Neuerfasstes, Übriges",
					amountMinor: growth.otherMinor,
				},
			]
		: [];
	const largest = Math.max(1, ...rows.map((row) => Math.abs(row.amountMinor)));

	return (
		<Card>
			<CardHeader
				title="Woher die Veränderung kommt"
				subtitle={
					growth
						? growth.window.clamped
							? `Seit ${f.date(growth.window.startDate)}`
							: `${f.date(growth.window.cashflowFrom)} – ${f.date(growth.window.endDate)}`
						: undefined
				}
				action={
					<div className="text-right">
						<p className="label-caps">Sparserie</p>
						<p className="text-sm font-semibold text-text">
							{streak.fullMonths === 0
								? "—"
								: streak.months === 1
									? "1 Monat"
									: `${streak.months} Monate`}
						</p>
					</div>
				}
			/>
			<CardBody className="space-y-4">
				<fieldset className="inline-flex rounded-control border border-border-strong p-0.5">
					<legend className="sr-only">Zeitraum</legend>
					{(Object.keys(PERIOD_LABELS) as GrowthPeriod[]).map((period) => (
						<button
							key={period}
							type="button"
							aria-pressed={progress.period === period}
							onClick={() => onPeriod(period)}
							className={cn(
								"rounded-[6px] px-3 py-1 text-xs font-medium outline-none pointer-coarse:min-h-11 focus-visible:outline-2 focus-visible:outline-focus",
								progress.period === period
									? "bg-brand-subtle text-brand"
									: "text-text-secondary hover:text-text",
							)}
						>
							{PERIOD_LABELS[period]}
						</button>
					))}
				</fieldset>
				{growth ? (
					<>
						<ul className="space-y-3">
							{rows.map((row) => (
								<li key={row.key} className="space-y-1">
									<div className="flex items-baseline justify-between gap-3">
										<div className="min-w-0">
											<p
												className={cn(
													"break-words text-sm",
													row.key === "saving"
														? "font-medium text-text"
														: "text-text-secondary",
												)}
											>
												{row.label}
											</p>
											<p className="break-words text-[11px] text-text-muted">
												{row.hint}
											</p>
										</div>
										<Money
											amountMinor={row.amountMinor}
											currency={currency}
											signed
											tone={row.key === "saving" ? "auto" : "default"}
											weight={row.key === "saving" ? "semibold" : "medium"}
											className="shrink-0 text-sm"
										/>
									</div>
									<div
										aria-hidden
										className="h-1 w-full overflow-hidden rounded-[2px] bg-surface-sunken"
									>
										<div
											className={cn(
												"h-full",
												row.amountMinor < 0
													? "bg-negative"
													: row.key === "saving"
														? "bg-positive"
														: "bg-chart-neutral-3",
											)}
											style={{
												width: `${(Math.abs(row.amountMinor) / largest) * 100}%`,
											}}
										/>
									</div>
								</li>
							))}
						</ul>
						<div className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
							<p className="text-sm text-text-secondary">
								{growth.depot === "excluded"
									? "Veränderung ohne Depotkurse"
									: "Veränderung"}
							</p>
							<Money
								amountMinor={growth.totalMinor}
								currency={currency}
								signed
								tone="auto"
								className="shrink-0 text-sm"
							/>
						</div>
						<p className="text-[11px] leading-relaxed text-text-muted">
							Sparleistung ist Einnahmen minus Ausgaben wie im Zahlungsfluss,
							ohne Umbuchungen zwischen eigenen Konten; Geld ins Depot ist weder
							Sparleistung noch Markt.
							{growth.depot === "excluded"
								? " Die Kurse des Depots fehlen, weil es für den Beginn des Zeitraums keinen Depotwert gibt; Ein- und Auszahlungen zählen mit ihrem Betrag."
								: ""}
						</p>
					</>
				) : (
					<p className="text-sm text-text-muted">
						Noch keine Daten für diesen Zeitraum.
					</p>
				)}
			</CardBody>
		</Card>
	);
}
