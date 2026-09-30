import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeftRight,
	CalendarClock,
	LineChart as LineChartIcon,
	MessageCircleMore,
	Wallet,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	HeroAction,
	HeroActions,
	HeroLabel,
	HeroPanel,
	HeroRing,
	HeroStat,
} from "@/components/hero-panel";
import { TickingMoney } from "@/components/ticking-money";
import {
	depotAgainstCost,
	heroFraming,
	isDownDay,
} from "@/domain/market-framing";
import {
	marketDisplayTarget,
	pulseMatchesConfirmed,
} from "@/domain/scalable-market-pulse";
import { Money, useFormat } from "@/lib/format";
import { indicativeNetWorth, useMarketPulse } from "@/lib/market-pulse";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";

type Dashboard = Awaited<ReturnType<typeof orpc.dashboard.call>>;

/**
 * The navy net-worth hero: the ticking figure inside the equity-ratio ring,
 * investable wealth, cash and growth. Hr. Körner's desk and the Übersicht
 * both render it, so the two pages show the same figure moving with the same
 * quotes and cannot drift apart.
 */
export function NetWorthHero({
	data,
	onAsk,
}: {
	data: Dashboard;
	/** On a phone the quick actions lead with "Fragen", which calls this. */
	onAsk?: () => void;
}) {
	const f = useFormat();
	const queryClient = useQueryClient();
	const nw = data.netWorth;
	const pulseQuery = useMarketPulse();
	const requestPulse = pulseQuery.refetch;
	const incomingPulse = pulseQuery.data;
	const reconciliationRef = useRef<string | null>(null);
	useEffect(() => {
		if (
			incomingPulse?.confirmedNetWorthMinor !== null &&
			incomingPulse?.confirmedNetWorthMinor !== undefined &&
			incomingPulse.confirmedNetWorthMinor !== nw.netWorthMinor
		) {
			const key = `${incomingPulse.confirmedNetWorthMinor}:${nw.netWorthMinor}`;
			if (reconciliationRef.current === key) return;
			reconciliationRef.current = key;
			void queryClient.invalidateQueries({
				queryKey: orpc.dashboard.queryKey(),
			});
			if (!document.hidden) void requestPulse();
		}
	}, [
		incomingPulse?.confirmedNetWorthMinor,
		nw.netWorthMinor,
		queryClient,
		requestPulse,
	]);
	const [pulseReady, setPulseReady] = useState(false);
	const [latestQuote, setLatestQuote] = useState<{
		baselineMinor: number;
		valueMinor: number;
	} | null>(null);
	useEffect(() => {
		const timeout = window.setTimeout(() => setPulseReady(true), 2_000);
		return () => window.clearTimeout(timeout);
	}, []);
	useEffect(() => {
		if (
			incomingPulse?.status === "available" &&
			incomingPulse.indicativeNetWorthMinor !== null &&
			pulseMatchesConfirmed(incomingPulse, nw.netWorthMinor)
		)
			setLatestQuote({
				baselineMinor: nw.netWorthMinor,
				valueMinor: incomingPulse.indicativeNetWorthMinor,
			});
	}, [incomingPulse, nw.netWorthMinor]);
	const displayWorth = marketDisplayTarget(
		nw.netWorthMinor,
		latestQuote,
		pulseReady,
	);
	// On a down day the line under the figure takes the longer view (the
	// owner's decision of 28.09.2026): a year ago, else the depot against its
	// cost. Up or flat, it stays the date. Same colour, no alarm.
	const down = pulseReady && isDownDay(incomingPulse, nw.netWorthMinor);
	const yearAgoPoint = data.history[0];
	const yearAgo =
		data.change.yearMinor !== null && yearAgoPoint
			? {
					date: yearAgoPoint.date,
					netWorthMinor: nw.netWorthMinor - data.change.yearMinor,
				}
			: null;
	const { data: positions } = useQuery({
		...orpc.investments.sourcePositions.queryOptions(),
		enabled: down && !yearAgo,
	});
	const framing = heroFraming({
		down,
		liveNetWorthMinor: indicativeNetWorth(nw.netWorthMinor, incomingPulse),
		yearAgo,
		depot: positions
			? depotAgainstCost(
					positions,
					incomingPulse?.depot ?? null,
					data.baseCurrency,
				)
			: null,
	});
	// The ring shows the equity ratio: how much of the assets is actually the
	// owner's once the liabilities are off. A real, computed share — a ring
	// filled for decoration would read as a measurement that nobody made.
	const equityRatio =
		nw.totalAssetsMinor > 0
			? Math.min(Math.max(nw.netWorthMinor / nw.totalAssetsMinor, 0), 1)
			: null;

	return (
		<HeroPanel className="px-4 pt-5 pb-4 sm:px-7 sm:py-8">
			<div className="flex flex-col items-center gap-4 sm:gap-7 lg:flex-row lg:items-center lg:gap-10">
				<div className="flex shrink-0 flex-col items-center gap-2">
					{/* No ratio, no fill: a full ring beside "nicht berechenbar"
					    claimed an equity ratio of 100 %. */}
					{/* Smaller on a phone so the figures below still fit the first
					    screen; the figure inside shrinks with it. */}
					<HeroRing
						progress={equityRatio ?? 0}
						size="clamp(12.5rem, 54vw, 16.75rem)"
					>
						<div className="min-w-0">
							<HeroLabel>Nettovermögen</HeroLabel>
							<p className="amount mt-2 max-w-full text-[clamp(1.125rem,5.2vw,2.125rem)] font-semibold leading-none tracking-[-0.02em] text-hero-text">
								<TickingMoney
									amountMinor={displayWorth}
									readingKey={incomingPulse?.checkedAt}
								/>
							</p>
							<p
								className="mt-2 font-mono text-[11px] uppercase tracking-[0.1em] text-hero-muted"
								data-framing={framing.kind}
							>
								{framing.kind === "year" ? (
									<>
										<span className="amount whitespace-nowrap">
											{f.money(framing.changeMinor, data.baseCurrency, {
												signed: true,
											})}
										</span>{" "}
										<span className="whitespace-nowrap">
											seit {f.date(framing.sinceDate, "month")}
										</span>
									</>
								) : framing.kind === "costBasis" ? (
									<>
										<span className="whitespace-nowrap">Depot</span>{" "}
										<span className="amount whitespace-nowrap">
											{f.money(framing.gainMinor, data.baseCurrency, {
												signed: true,
											})}
										</span>{" "}
										<span className="whitespace-nowrap">seit Kauf</span>
									</>
								) : (
									f.date(data.today, "short")
								)}
							</p>
						</div>
					</HeroRing>
					<p className="max-w-[16rem] text-center text-[11px] text-hero-muted">
						{equityRatio === null
							? "Eigenkapitalquote nicht berechenbar"
							: `Eigenkapitalquote ${f
									.percent(equityRatio * 100)
									.replace("+", "")} des Vermögens`}
					</p>
				</div>
				<div className="w-full min-w-0 flex-1 space-y-4 sm:space-y-6">
					<div className="hero-stagger grid grid-cols-2 gap-3 sm:gap-5 [&>*]:min-w-0">
						<HeroStat
							className="max-sm:text-center"
							label="Investierbares Vermögen"
							value={
								<Money amountMinor={nw.investmentsMinor} compact animate />
							}
							detail="Wertpapiere und Investmentpositionen"
						/>
						<HeroStat
							className="max-sm:text-center"
							label="Liquide Mittel"
							value={<Money amountMinor={nw.cashMinor} compact animate />}
							detail={`${
								nw.totalAssetsMinor > 0
									? f
											.percent((nw.cashMinor / nw.totalAssetsMinor) * 100)
											.replace("+", "")
									: "—"
							} des Vermögens`}
						/>
					</div>
					<div className="border-t border-hero-border/70 pt-3 max-sm:text-center sm:pt-4">
						<HeroLabel>
							Wachstum p. a.{" "}
							{data.cagr.sinceDate
								? `seit ${f.date(data.cagr.sinceDate, "month")}`
								: ""}
						</HeroLabel>
						{data.cagr.netWorth !== null || data.cagr.investable !== null ? (
							<div className="mt-1.5 grid min-w-0 gap-1 text-sm sm:flex sm:flex-wrap sm:gap-x-6">
								<span className="min-w-0 break-words">
									<span className="text-hero-muted">Nettovermögen </span>
									<span
										className={cn(
											"amount break-all whitespace-normal font-semibold text-[clamp(0.75rem,3.5vw,0.875rem)] text-hero-text",
											(data.cagr.netWorth ?? 0) < 0 && "text-negative",
										)}
									>
										{data.cagr.netWorth === null
											? "—"
											: f.percent(data.cagr.netWorth)}
									</span>
								</span>
								<span className="min-w-0 break-words">
									<span className="text-hero-muted">Anlagevermögen </span>
									<span
										className={cn(
											"amount break-all whitespace-normal font-semibold text-[clamp(0.75rem,3.5vw,0.875rem)] text-hero-text",
											(data.cagr.investable ?? 0) < 0 && "text-negative",
										)}
									>
										{data.cagr.investable === null
											? "—"
											: f.percent(data.cagr.investable)}
									</span>
								</span>
							</div>
						) : (
							<p className="mt-1 text-sm text-hero-muted">
								{data.providerHistoryGap
									? "Jahresrate folgt ab dem ersten vollen Vergleichsjahr"
									: "Noch keine belastbare Jahresrate"}
							</p>
						)}
					</div>
				</div>
			</div>
			{/* Konten and Umsätze are tabs on a phone; there the row leads with
			    the conversation instead, which otherwise sits at the page end. */}
			<HeroActions className="mt-4 border-t border-hero-border/70 pt-4 sm:mt-7 sm:pt-6">
				{onAsk ? (
					<HeroAction
						icon={MessageCircleMore}
						label="Fragen"
						onClick={onAsk}
						className="sm:hidden"
					/>
				) : null}
				<HeroAction
					icon={Wallet}
					label="Konten"
					to="/accounts"
					className="max-sm:hidden"
				/>
				<HeroAction
					icon={ArrowLeftRight}
					label="Umsätze"
					to="/transactions"
					className="max-sm:hidden"
				/>
				<HeroAction icon={LineChartIcon} label="Verlauf" to="/net-worth" />
				<HeroAction icon={CalendarClock} label="Geplant" to="/cashflow" />
			</HeroActions>
		</HeroPanel>
	);
}
