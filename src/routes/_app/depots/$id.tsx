import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import * as v from "valibot";
import { PageHeader } from "@/components/page-header";
import { StatRow, StatTile } from "@/components/stat-tile";
import { TickingMoney } from "@/components/ticking-money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	depotIndicative,
	pulseMatchesConfirmed,
} from "@/domain/scalable-market-pulse";
import { Money, useFormat } from "@/lib/format";
import {
	assetClassLabel,
	INVESTMENT_TRANSACTION_KIND_LABELS,
	investmentStatusLabel,
} from "@/lib/labels";
import { useMarketPulse, useMarketTicker } from "@/lib/market-pulse";
import { orpc } from "@/lib/orpc";

const PAGE_SIZE = 50;
const PageNumber = v.pipe(
	v.number(),
	v.integer(),
	v.minValue(1),
	v.maxValue(2000),
);

export const Route = createFileRoute("/_app/depots/$id")({
	validateSearch: (search) => {
		const result = v.safeParse(PageNumber, Number(search.page ?? 1));
		return { page: result.success ? result.output : 1 };
	},
	loaderDeps: ({ search }) => ({ page: search.page }),
	loader: ({ context, params, deps }) =>
		context.queryClient.ensureQueryData(
			orpc.investments.sourceAccount.queryOptions({
				input: {
					id: params.id,
					offset: (deps.page - 1) * PAGE_SIZE,
					limit: PAGE_SIZE,
				},
			}),
		),
	head: () => ({ meta: [{ title: "Depot · Fortuna" }] }),
	component: DepotDetail,
});

function DepotDetail() {
	const { id } = Route.useParams();
	const { page } = Route.useSearch();
	const { data } = useSuspenseQuery(
		orpc.investments.sourceAccount.queryOptions({
			input: { id, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE },
		}),
	);
	const { account, positions, transactions } = data;
	const f = useFormat();
	// Between two syncs the depot ticks with the quotes, like the dashboard:
	// only against the snapshot the pulse was computed for, never stored.
	const { data: netWorth } = useQuery(orpc.netWorth.current.queryOptions());
	const { data: pulse } = useMarketPulse();
	const pulseMatches = Boolean(
		pulse?.status === "available" &&
			pulse.depot?.accountId === account.id &&
			netWorth &&
			pulseMatchesConfirmed(pulse, netWorth.netWorthMinor),
	);
	const moves = pulseMatches ? (pulse?.depot?.positions ?? []) : [];
	const liveDepotValue = depotIndicative(
		account.portfolioValueMinor,
		account.currency,
		moves,
		pulseMatches,
	);
	const livePositionValue = (
		isin: string,
		valueMinor: number | null,
		currency: string,
	) =>
		depotIndicative(
			valueMinor,
			currency,
			moves.filter((move) => move.isin === isin),
			pulseMatches,
		);
	const stale =
		!account.valuationAt ||
		Date.now() - new Date(account.valuationAt).getTime() > 30 * 86400_000;
	const holdingsValue = positions.reduce(
		(sum, position) => sum + (position.valueMinor ?? 0),
		0,
	);
	const hasCompleteHoldingsValue =
		positions.length > 0 &&
		positions.every(
			(position) =>
				position.valueMinor !== null && position.currency === account.currency,
		);
	const discrepancy =
		hasCompleteHoldingsValue && account.portfolioValueMinor !== null
			? account.portfolioValueMinor -
				holdingsValue -
				(account.cryptoValueMinor ?? 0)
			: null;
	const pageCount = Math.max(1, Math.ceil(data.transactionCount / PAGE_SIZE));
	return (
		<div className="space-y-5">
			<PageHeader
				title={account.label}
				subtitle={
					<span className="flex flex-wrap items-center gap-2">
						<Link to="/accounts" className="text-brand hover:underline">
							Konten
						</Link>
						<span>·</span>Scalable Capital ·{" "}
						{account.method === "cli"
							? "automatisch abgeglichen"
							: "manuell importiert"}
						<Badge
							variant={account.status === "active" ? "positive" : "warning"}
						>
							{account.status === "active" ? "Aktiv" : "Letzter Bestand"}
						</Badge>
						{stale ? <Badge variant="warning">Bewertung veraltet</Badge> : null}
					</span>
				}
				actions={
					<Button asChild variant="outline">
						<Link
							to="/connections"
							search={{
								bank: undefined,
								imported: undefined,
								remise: undefined,
							}}
						>
							Verbindung verwalten
						</Link>
					</Button>
				}
			/>
			<StatRow className="xl:grid-cols-4">
				<StatTile
					label="Depotwert"
					value={
						account.portfolioValueMinor === null ? (
							"nicht verfügbar"
						) : (
							<TickingMoney
								amountMinor={liveDepotValue ?? account.portfolioValueMinor}
								readingKey={pulse?.checkedAt}
								currency={account.currency}
								className="text-[22px]"
							/>
						)
					}
					detail={
						account.valuationAt
							? `Bewertet ${f.dateTime(account.valuationAt)}`
							: "Ohne Bewertungszeitpunkt"
					}
				/>
				<StatTile
					label="Guthaben"
					value={
						account.cashBalanceMinor === null ? (
							"nicht verfügbar"
						) : (
							<Money
								amountMinor={account.cashBalanceMinor}
								currency={account.currency}
								className="text-[22px]"
							/>
						)
					}
					detail="Guthaben im Depot"
				/>
				<StatTile
					label="Positionen"
					value={String(account.positionCount)}
					detail={
						account.unvaluedPositionCount
							? `${account.unvaluedPositionCount} ohne Geldwert`
							: "Alle Positionen mit Geldwert"
					}
				/>
				<StatTile
					label="Buchungen"
					value={String(account.transactionCount)}
					detail={
						account.lastSyncAt
							? `Letzter Abgleich ${f.dateTime(account.lastSyncAt)}`
							: "Noch kein Abgleich"
					}
				/>
			</StatRow>
			{account.cryptoValueMinor !== null && account.cryptoValueMinor > 0 ? (
				<Card>
					<CardHeader
						title="Kryptowert im Depot"
						subtitle="Ohne Einzelpositionen; im Depotwert oben bereits enthalten."
					/>
					<p className="px-4 pb-4">
						<Money
							amountMinor={account.cryptoValueMinor}
							currency={account.currency}
						/>
					</p>
				</Card>
			) : null}
			{account.lastError ? (
				<p className="rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning">
					{account.lastError}
				</p>
			) : null}
			{discrepancy !== null && Math.abs(discrepancy) > 1 ? (
				<p className="rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning">
					Die Summe der Einzelpositionen weicht um{" "}
					{f.money(discrepancy, account.currency)} vom gemeldeten
					Depotgesamtwert ab. Für das Nettovermögen gilt der Depotgesamtwert.
				</p>
			) : null}
			<Card>
				<CardHeader
					title={`Positionen (${positions.length})`}
					subtitle="Direkt aus dem gewählten Broker-Portfolio. Ein fehlender Preis wird nicht geschätzt."
				/>
				{positions.length === 0 ? (
					<EmptyState
						title="Keine Positionen"
						description="Der letzte Anbieterabgleich enthält keine Wertpapierpositionen."
					/>
				) : (
					<div className="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Wertpapier</TableHead>
									<TableHead className="text-right">Stückzahl</TableHead>
									<TableHead className="text-right">Kurs</TableHead>
									<TableHead className="text-right">Einstand</TableHead>
									<TableHead className="text-right">Wert</TableHead>
									<TableHead className="text-right">Gewinn</TableHead>
									<TableHead>Bewertung</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{positions.map((position) => {
									const positionStale =
										!position.valuationAt ||
										Date.now() - new Date(position.valuationAt).getTime() >
											30 * 86400_000 ||
										position.verification === "stale";
									const gainAvailable =
										position.valueMinor !== null &&
										position.costBasisMinor !== null &&
										!["csv_acquisition_cost", "scalable_fifo_cost"].includes(
											position.valuationSource ?? "",
										);
									return (
										<TableRow key={position.id}>
											<TableCell>
												<span className="font-medium">
													{position.instrumentName}
												</span>
												<span className="block font-mono text-xs text-text-muted">
													{position.isin}
													{position.wkn ? ` · WKN ${position.wkn}` : ""}
													{position.ticker ? ` · ${position.ticker}` : ""}
												</span>
												{position.assetClass ? (
													<span className="block text-xs text-text-muted">
														{assetClassLabel(position.assetClass)}
													</span>
												) : null}
											</TableCell>
											<TableCell className="amount text-right">
												{f.number(position.quantity, 6)}
											</TableCell>
											<TableCell className="amount text-right">
												{position.price === null
													? "—"
													: `${f.number(position.price, 4)} ${position.currency}`}
											</TableCell>
											<TableCell className="text-right">
												{position.costBasisMinor === null ? (
													"—"
												) : (
													<Money
														amountMinor={position.costBasisMinor}
														currency={position.currency}
													/>
												)}
											</TableCell>
											<LiveValueCells
												valueMinor={
													position.valueMinor === null
														? null
														: (livePositionValue(
																position.isin,
																position.valueMinor,
																position.currency,
															) ?? position.valueMinor)
												}
												costBasisMinor={
													gainAvailable ? position.costBasisMinor : null
												}
												currency={position.currency}
												readingKey={pulse?.checkedAt}
											/>
											<TableCell>
												<Badge variant={positionStale ? "warning" : "default"}>
													{position.valueMinor === null
														? "ohne Wert"
														: positionStale
															? "veraltet"
															: position.verification === "provider_reported"
																? "Anbieterwert"
																: "geschätzt"}
												</Badge>
												<span className="block text-xs text-text-muted">
													{position.valuationAt
														? f.dateTime(position.valuationAt)
														: "ohne Zeitpunkt"}
												</span>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</div>
				)}
			</Card>
			<Card>
				<CardHeader
					title={`Buchungen (${data.transactionCount})`}
					subtitle="Getrennt von den Bankumsätzen geführt."
				/>
				{transactions.length === 0 ? (
					<EmptyState
						title="Keine Buchungen"
						description="Für dieses Depot liegen keine Buchungen vor."
					/>
				) : (
					<div className="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Zeitpunkt</TableHead>
									<TableHead>Art</TableHead>
									<TableHead>Wertpapier / Referenz</TableHead>
									<TableHead className="text-right">Stückzahl</TableHead>
									<TableHead className="text-right">Betrag</TableHead>
									<TableHead className="text-right">Gebühr / Steuer</TableHead>
									<TableHead>Status</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{transactions.map((transaction) => (
									<TableRow key={transaction.id}>
										<TableCell className="whitespace-nowrap text-xs">
											{f.dateTime(transaction.occurredAt)}
										</TableCell>
										<TableCell>
											{INVESTMENT_TRANSACTION_KIND_LABELS[transaction.kind] ??
												"—"}
										</TableCell>
										<TableCell>
											<span className="block break-words">
												{transaction.instrumentName ?? "—"}
											</span>
											<span className="block font-mono text-[11px] text-text-muted">
												{transaction.isin ??
													`Referenz ···${transaction.sourceId.slice(-8)}`}
											</span>
										</TableCell>
										<TableCell className="amount text-right">
											{transaction.quantity === null
												? "—"
												: f.number(transaction.quantity, 6)}
										</TableCell>
										<TableCell className="text-right">
											<Money
												amountMinor={transaction.amountMinor}
												currency={transaction.currency}
												tone="auto"
												signed
											/>
										</TableCell>
										<TableCell className="text-right">
											{transaction.feeMinor === null &&
											transaction.taxMinor === null ? (
												"—"
											) : (
												<span>
													{transaction.feeMinor !== null
														? f.money(
																transaction.feeMinor,
																transaction.currency,
															)
														: "—"}{" "}
													/{" "}
													{transaction.taxMinor !== null
														? f.money(
																transaction.taxMinor,
																transaction.currency,
															)
														: "—"}
												</span>
											)}
										</TableCell>
										<TableCell>
											{investmentStatusLabel(transaction.status)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}
				{pageCount > 1 ? (
					<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm">
						<span>
							Seite {page} von {pageCount}
						</span>
						<div className="flex gap-2">
							{page > 1 ? (
								<Button asChild variant="outline" size="sm">
									<Link
										to="/depots/$id"
										params={{ id }}
										search={{ page: page - 1 }}
									>
										Zurück
									</Link>
								</Button>
							) : (
								<Button variant="outline" size="sm" disabled>
									Zurück
								</Button>
							)}
							{page < pageCount ? (
								<Button asChild variant="outline" size="sm">
									<Link
										to="/depots/$id"
										params={{ id }}
										search={{ page: page + 1 }}
									>
										Weiter
									</Link>
								</Button>
							) : (
								<Button variant="outline" size="sm" disabled>
									Weiter
								</Button>
							)}
						</div>
					</div>
				) : null}
			</Card>
		</div>
	);
}

/**
 * A holding's value and gain, ticking together: one bridge per row, the gain
 * derived from it, so the two never wobble apart.
 */
function LiveValueCells({
	valueMinor,
	costBasisMinor,
	currency,
	readingKey,
}: {
	valueMinor: number | null;
	costBasisMinor: number | null;
	currency: string;
	readingKey: unknown;
}) {
	const shown = useMarketTicker(
		valueMinor ?? 0,
		readingKey,
		valueMinor !== null,
	);
	return (
		<>
			<TableCell className="text-right">
				{valueMinor === null ? (
					"nicht verfügbar"
				) : (
					<Money
						amountMinor={shown}
						currency={currency}
						animate
						countUp={false}
					/>
				)}
			</TableCell>
			<TableCell className="text-right">
				{valueMinor !== null && costBasisMinor !== null ? (
					<Money
						amountMinor={shown - costBasisMinor}
						currency={currency}
						tone="auto"
						signed
						animate
						countUp={false}
					/>
				) : (
					"—"
				)}
			</TableCell>
		</>
	);
}
