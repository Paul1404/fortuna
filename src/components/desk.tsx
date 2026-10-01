import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	ArrowRight,
	Check,
	ChevronDown,
	Landmark,
	RotateCcw,
} from "lucide-react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CategoryReviewDialog } from "@/components/category-review";
import { InvestDialog, isTransferDone } from "@/components/investment-advice";
import { ReservePot } from "@/components/reserve-pot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { MIN_ORDER_MINOR } from "@/domain/capital-advice";
import type {
	DeskAction,
	DeskFiled,
	DeskTask,
	DeskToday,
	LiquidityTier,
} from "@/domain/desk-contract";
import { Money, useFormat } from "@/lib/format";
import { reportError, useInvalidateAll } from "@/lib/forms";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";

/* ── Filed ────────────────────────────────────────────────────────────────── */

/**
 * Hr. Körner files what repeats the owner's own decisions when the desk
 * opens, once per visit, and reports it here with an undo.
 */
export function FiledNote() {
	const invalidate = useInvalidateAll();
	const [filed, setFiled] = useState<DeskFiled | null>(null);
	const started = useRef(false);
	const fileCertain = useMutation(
		orpc.desk.fileCertain.mutationOptions({
			onSuccess: async (result) => {
				setFiled(result);
				if (result.count > 0) await invalidate();
			},
			// Silent on failure: nothing was filed, and the bookings stay in the
			// review where the owner can still clear them.
		}),
	);
	const unfile = useMutation(
		orpc.desk.unfile.mutationOptions({
			onSuccess: async (result) => {
				setFiled(null);
				await invalidate();
				toast.success(
					result.cleared === 1
						? "1 Buchung ist wieder offen"
						: `${result.cleared} Buchungen sind wieder offen`,
				);
			},
			onError: reportError,
		}),
	);
	const { mutate } = fileCertain;
	useEffect(() => {
		if (started.current) return;
		started.current = true;
		mutate(undefined);
	}, [mutate]);

	if (!filed || filed.count === 0) return null;
	return (
		<div className="flex flex-wrap items-start gap-x-3 gap-y-1 px-1 text-sm text-text-secondary">
			<Check className="mt-0.5 size-4 shrink-0 text-positive" />
			<details className="min-w-0 flex-1">
				<summary className="cursor-pointer break-words">
					Hr. Körner hat{" "}
					{filed.count === 1 ? "1 Buchung" : `${filed.count} Buchungen`}{" "}
					abgelegt.
				</summary>
				{filed.summary.length ? (
					<ul className="mt-1.5 space-y-0.5 text-xs text-text-muted">
						{filed.summary.map((line) => (
							<li key={line} className="break-words">
								{line}
							</li>
						))}
					</ul>
				) : null}
			</details>
			<Button
				variant="ghost"
				size="sm"
				disabled={unfile.isPending}
				onClick={() => unfile.mutate({ transactionIds: filed.transactionIds })}
			>
				<RotateCcw /> Rückgängig
			</Button>
		</div>
	);
}

/* ── Heute zu tun ─────────────────────────────────────────────────────────── */

/**
 * "Freies Geld" stays off the desk for a few days once the owner reported the
 * transfer made and nothing is left to buy with the cash already at the
 * broker: the bank needs that long to show it.
 */
function waitingForTransfer(task: DeskTask): boolean {
	const action = task.action;
	return (
		action.kind === "invest_money" &&
		action.bankMinor > 0 &&
		action.brokerMinor < MIN_ORDER_MINOR &&
		isTransferDone(action.bankMinor)
	);
}

const SEVERITY_BADGE = {
	urgent: { label: "Dringend", variant: "negative" },
	review: { label: "Prüfen", variant: "warning" },
	info: null,
} as const;

function actionLabel(action: DeskAction): string {
	switch (action.kind) {
		case "review_bookings":
			return "Durchsehen";
		case "invest_money":
			return "Anlegen";
		case "update_value":
			return "Aktualisieren";
		case "open":
			return "Öffnen";
		case "observation":
			return "Absichtlich";
	}
}

type Opened = { kind: "review" } | { kind: "invest" };

/**
 * "Heute zu tun" and the liquidity card share one "Anlegen" dialog, so the
 * money named on both is one proposal.
 */
export function DeskSections({ today }: { today: DeskToday }) {
	const [opened, setOpened] = useState<Opened | null>(null);
	// Read after mount: the done marks live in this browser's storage only.
	const [hidden, setHidden] = useState<Set<string>>(new Set());
	const recheck = useCallback(
		() =>
			setHidden(
				new Set(today.tasks.filter(waitingForTransfer).map((task) => task.key)),
			),
		[today.tasks],
	);
	useEffect(recheck, [recheck]);
	const tasks = today.tasks.filter((task) => !hidden.has(task.key));
	const invest = tasks.some((task) => task.action.kind === "invest_money");

	function open(task: DeskTask) {
		if (task.action.kind === "review_bookings") setOpened({ kind: "review" });
		else if (task.action.kind === "invest_money") setOpened({ kind: "invest" });
	}

	return (
		<>
			<TodayCard tasks={tasks} currency={today.baseCurrency} onOpen={open} />
			<LiquidityCard
				today={today}
				onInvest={invest ? () => setOpened({ kind: "invest" }) : null}
			/>
			{opened?.kind === "review" ? (
				<Suspense fallback={<LoadingDialog title="Buchungen zuordnen" />}>
					<CategoryReviewDialog
						open
						onOpenChange={(value) => !value && setOpened(null)}
					/>
				</Suspense>
			) : null}
			{opened?.kind === "invest" ? (
				<InvestDialog
					onClose={() => setOpened(null)}
					onTransferDone={recheck}
				/>
			) : null}
		</>
	);
}

function TodayCard({
	tasks,
	currency,
	onOpen,
}: {
	tasks: DeskTask[];
	currency: string;
	onOpen: (task: DeskTask) => void;
}) {
	return (
		<Card>
			<CardHeader
				title="Heute zu tun"
				action={
					<Link to="/hr-koerner" className="text-xs text-brand hover:underline">
						Erledigt und entschieden
					</Link>
				}
			/>
			{tasks.length === 0 ? (
				<CardBody>
					<p className="text-sm text-text-secondary">Heute liegt nichts an.</p>
				</CardBody>
			) : (
				<ul className="divide-y divide-border border-t border-border">
					{tasks.map((task) => (
						<TaskRow
							key={task.key}
							task={task}
							currency={currency}
							onOpen={() => onOpen(task)}
						/>
					))}
				</ul>
			)}
		</Card>
	);
}

function TaskRow({
	task,
	currency,
	onOpen,
}: {
	task: DeskTask;
	currency: string;
	onOpen: () => void;
}) {
	const badge = SEVERITY_BADGE[task.severity];
	return (
		// On a phone: text and amount on top, the one action full width below,
		// where the thumb is. From `sm` up it is one row again.
		<li className="px-4 py-3 sm:flex sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
			<div className="flex min-w-0 flex-1 items-start gap-3 sm:basis-64 sm:items-center">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<p className="break-words text-sm font-medium text-text">
							{task.title}
						</p>
						{badge ? (
							<Badge variant={badge.variant}>{badge.label}</Badge>
						) : null}
					</div>
					<p className="mt-0.5 break-words text-xs text-text-secondary">
						{task.detail}
					</p>
				</div>
				{task.amountMinor !== null ? (
					<Money
						amountMinor={task.amountMinor}
						currency={currency}
						className="shrink-0 text-sm"
					/>
				) : null}
			</div>
			<div className="mt-2.5 sm:mt-0 max-sm:[&>*]:w-full">
				<TaskAction task={task} onOpen={onOpen} />
			</div>
		</li>
	);
}

/**
 * The domain hands out hrefs with a query ("/debts?highlight=…"); the
 * router wants the path and the search apart, or the query ends up encoded
 * into the path.
 */
function hrefLink(href: string): { to: string; search?: never } {
	const [to, query] = href.split("?");
	return query
		? { to, search: Object.fromEntries(new URLSearchParams(query)) as never }
		: { to };
}

function TaskAction({ task, onOpen }: { task: DeskTask; onOpen: () => void }) {
	const action = task.action;
	if (action.kind === "observation")
		return action.href ? (
			// A stale value: the fix is one tap away, the decision beside it.
			<div className="flex gap-2 max-sm:[&>*]:flex-1">
				<Button asChild variant="outline" size="sm">
					<Link {...hrefLink(action.href)}>
						Aktualisieren <ArrowRight />
					</Link>
				</Button>
				<ObservationActions id={action.observationId} />
			</div>
		) : (
			<ObservationActions id={action.observationId} />
		);
	if (action.kind === "update_value" || action.kind === "open")
		return (
			<Button asChild variant="outline" size="sm">
				<Link {...hrefLink(action.href)}>
					{actionLabel(action)} <ArrowRight />
				</Link>
			</Button>
		);
	return (
		<Button
			variant={task.severity === "info" ? "outline" : "default"}
			size="sm"
			onClick={onOpen}
		>
			{actionLabel(action)}
		</Button>
	);
}

function ObservationActions({ id }: { id: string }) {
	const invalidate = useInvalidateAll();
	const update = useMutation(
		orpc.hrKoerner.updateObservation.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Hinweis aktualisiert");
			},
			onError: reportError,
		}),
	);
	// Three equal-weight buttons wrapped into two lines on a phone for every
	// observation; one trigger keeps the row calm and the choices explained.
	return (
		<Menu>
			<MenuTrigger asChild>
				<Button variant="outline" size="sm" disabled={update.isPending}>
					Entscheiden <ChevronDown />
				</Button>
			</MenuTrigger>
			<MenuContent>
				<MenuItem onSelect={() => update.mutate({ id, status: "intentional" })}>
					Absichtlich
					<span className="text-xs text-text-muted">
						So gewollt, nicht mehr melden
					</span>
				</MenuItem>
				<MenuItem
					onSelect={() =>
						update.mutate({
							id,
							status: "snoozed",
							snoozedUntil: new Date(Date.now() + 7 * 86_400_000),
						})
					}
				>
					7 Tage pausieren
					<span className="text-xs text-text-muted">
						Danach wieder vorlegen
					</span>
				</MenuItem>
				<MenuItem onSelect={() => update.mutate({ id, status: "dismissed" })}>
					Ausblenden
					<span className="text-xs text-text-muted">
						Diesen Hinweis verwerfen
					</span>
				</MenuItem>
			</MenuContent>
		</Menu>
	);
}

function LoadingDialog({ title }: { title: string }) {
	return (
		<Dialog open>
			<DialogContent title={title} className="max-w-md">
				<p className="text-sm text-text-muted">Lade …</p>
			</DialogContent>
		</Dialog>
	);
}

/* ── Wie flüssig ist das Vermögen ─────────────────────────────────────────── */

const TIERS: {
	tier: LiquidityTier;
	label: string;
	hint: string;
	color: string;
}[] = [
	{
		tier: "now",
		label: "Sofort",
		hint: "heute verfügbar",
		color: "var(--fortuna-chart-1)",
	},
	{
		tier: "days",
		label: "In Tagen",
		hint: "nach Verkauf oder Kündigungsfrist",
		color: "var(--fortuna-chart-3)",
	},
	{
		tier: "locked",
		label: "Gebunden",
		hint: "erst ab einem Datum",
		color: "var(--fortuna-chart-6)",
	},
	{
		tier: "sellable",
		label: "Verkäuflich",
		hint: "nur über einen Verkauf",
		color: "var(--fortuna-chart-4)",
	},
];

function LiquidityCard({
	today,
	onInvest,
}: {
	today: DeskToday;
	onInvest: (() => void) | null;
}) {
	const f = useFormat();
	const { liquidity, lazyCash } = today;
	const currency = liquidity.baseCurrency;
	const [showItems, setShowItems] = useState(false);
	const positive = TIERS.reduce(
		(sum, { tier }) => sum + Math.max(0, liquidity.totals[tier]),
		0,
	);
	return (
		<Card>
			<CardHeader title="Wie flüssig ist das Vermögen" />
			<CardBody className="space-y-4">
				{positive > 0 ? (
					<div
						className="flex h-3 w-full overflow-hidden rounded-[2px] bg-surface-sunken"
						role="img"
						aria-label={TIERS.map(
							({ tier, label }) =>
								`${label} ${f.money(liquidity.totals[tier], currency)}`,
						).join(", ")}
					>
						{TIERS.map(({ tier, color }) => {
							const share = Math.max(0, liquidity.totals[tier]) / positive;
							return share > 0 ? (
								<div
									key={tier}
									className="h-full border-r border-surface last:border-r-0"
									style={{ width: `${share * 100}%`, background: color }}
								/>
							) : null;
						})}
					</div>
				) : null}
				{/* On a phone each tier is one line with its total; the positions
				    behind them open on request, or the card ran four screens. */}
				<div className="grid gap-4 max-sm:gap-0 max-sm:divide-y max-sm:divide-border sm:grid-cols-2 xl:grid-cols-4">
					{TIERS.map(({ tier, label, hint, color }) => {
						const items = liquidity.items.filter((item) => item.tier === tier);
						return (
							<section key={tier} className="min-w-0 max-sm:py-2.5">
								<div className="flex items-baseline justify-between gap-3 sm:block">
									<div className="flex items-center gap-2">
										<span
											aria-hidden
											className="size-2.5 shrink-0 rounded-[2px]"
											style={{ background: color }}
										/>
										<h3 className="label-caps">{label}</h3>
									</div>
									<p className="amount font-semibold sm:mt-1 sm:text-lg">
										<Money
											amountMinor={liquidity.totals[tier]}
											currency={currency}
										/>
									</p>
								</div>
								<p className="text-[11px] text-text-muted">
									{positive > 0
										? `${f
												.percent(
													(Math.max(0, liquidity.totals[tier]) / positive) *
														100,
													0,
												)
												.replace("+", "")} · ${hint}`
										: hint}
								</p>
								{items.length ? (
									<ul
										className={cn(
											"mt-2 space-y-1.5",
											!showItems && "max-sm:hidden",
										)}
									>
										{items.map((item) => (
											<li key={item.id} className="text-[13px]">
												<div className="flex items-baseline justify-between gap-2">
													{item.href ? (
														<Link
															{...hrefLink(item.href)}
															className="min-w-0 break-words text-text hover:text-brand hover:underline"
														>
															{item.name}
														</Link>
													) : (
														<span className="min-w-0 break-words text-text">
															{item.name}
														</span>
													)}
													<Money
														amountMinor={item.valueMinor}
														currency={currency}
														weight="medium"
														className="shrink-0 text-[13px]"
													/>
												</div>
												{tier === "locked" && item.availableFrom ? (
													<p className="text-[11px] text-text-muted">
														ab {f.date(item.availableFrom)}
													</p>
												) : null}
												{item.note ? (
													<p className="break-words text-[11px] text-text-muted">
														{item.note}
													</p>
												) : null}
											</li>
										))}
									</ul>
								) : (
									<p
										className={cn(
											"mt-2 text-[11px] text-text-muted",
											!showItems && "max-sm:hidden",
										)}
									>
										—
									</p>
								)}
							</section>
						);
					})}
				</div>
				<Button
					variant="ghost"
					size="sm"
					className="w-full sm:hidden"
					aria-expanded={showItems}
					onClick={() => setShowItems((current) => !current)}
				>
					{showItems ? "Positionen ausblenden" : "Positionen zeigen"}
					<ChevronDown className={cn(showItems && "rotate-180")} />
				</Button>
				{today.reservePot ? (
					<ReservePot
						pot={today.reservePot}
						currency={currency}
						className="border-t border-border pt-3"
					/>
				) : null}
				{lazyCash && lazyCash.excessMinor > 0 ? (
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3 text-sm text-text-secondary max-sm:[&>button]:w-full">
						<Landmark className="size-4 shrink-0 text-brand" />
						<p className="min-w-0 flex-1 basis-64 break-words">
							Auf den Konten liegen{" "}
							<Money amountMinor={lazyCash.excessMinor} currency={currency} />{" "}
							mehr, als Reserve (
							<Money
								amountMinor={lazyCash.reserveMinor}
								currency={currency}
								weight="normal"
							/>
							) und Cash-Anteil (
							<Money
								amountMinor={lazyCash.cashTargetMinor}
								currency={currency}
								weight="normal"
							/>
							) verlangen.
						</p>
						{onInvest ? (
							<Button size="sm" variant="outline" onClick={onInvest}>
								Anlegen
							</Button>
						) : null}
					</div>
				) : null}
			</CardBody>
		</Card>
	);
}
