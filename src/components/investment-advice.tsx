import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, CircleAlert, ClipboardCopy, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BrokerOrderDialog, type OrderTicket } from "@/components/broker-order";
import { ReservePot } from "@/components/reserve-pot";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AmountInput } from "@/components/ui/input";
import {
	BUCKET_LABELS,
	BUCKETS,
	describeSplit,
	type TargetSplit,
} from "@/domain/capital-advice";
import { reservePot } from "@/domain/progress";
import { Money } from "@/lib/format";
import { reportError, toAmountInput, useInvalidateAll } from "@/lib/forms";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";

type PlanContext = Awaited<ReturnType<typeof orpc.investmentAdvice.plan.call>>;

/* ── Transfer "Erledigt", remembered in this browser ─────────────────────── */

const DONE_KEY = "fortuna-desk-done-v1";
/** A transfer takes a day or two to show at the bank; remember it that long. */
const DONE_FOR_MS = 3 * 86_400_000;

function readDone(): Record<string, number> {
	try {
		const raw = JSON.parse(localStorage.getItem(DONE_KEY) ?? "{}") as Record<
			string,
			number
		>;
		const now = Date.now();
		return Object.fromEntries(
			Object.entries(raw).filter(
				([, at]) => typeof at === "number" && now - at < DONE_FOR_MS,
			),
		);
	} catch {
		return {};
	}
}

/** True when the owner said this transfer is made, within the last days. */
export function isTransferDone(amountMinor: number): boolean {
	return `transfer:${amountMinor}` in readDone();
}

function markTransferDone(amountMinor: number) {
	try {
		localStorage.setItem(
			DONE_KEY,
			JSON.stringify({
				...readDone(),
				[`transfer:${amountMinor}`]: Date.now(),
			}),
		);
	} catch {
		// Storage blocked: the step is only ticked until the page reloads.
	}
}

/* ── Anlegen ─────────────────────────────────────────────────────────────── */

/**
 * "Anlegen" as a dialog, opened from the desk's "Freies Geld". A buy opens
 * the broker-order dialog in its place and returns here when it closes.
 */
export function InvestDialog({
	onClose,
	onTransferDone,
}: {
	onClose: () => void;
	onTransferDone?: () => void;
}) {
	const [ticket, setTicket] = useState<OrderTicket | null>(null);
	if (ticket)
		return (
			<BrokerOrderDialog ticket={ticket} onClose={() => setTicket(null)} />
		);
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				title="Anlegen"
				description="Reserve zuerst, dann nach Ihrer Zielaufteilung in das, was schon im Depot liegt."
				className="max-w-2xl"
			>
				<InvestBody onBuy={setTicket} onTransferDone={onTransferDone} />
			</DialogContent>
		</Dialog>
	);
}

/** The same content on the "Anlegen" page, with its own order dialog. */
export function InvestPanel() {
	const [ticket, setTicket] = useState<OrderTicket | null>(null);
	return (
		<>
			<InvestBody onBuy={setTicket} />
			{ticket ? (
				<BrokerOrderDialog ticket={ticket} onClose={() => setTicket(null)} />
			) : null}
		</>
	);
}

function InvestBody({
	onBuy,
	onTransferDone,
}: {
	onBuy: (ticket: OrderTicket) => void;
	onTransferDone?: () => void;
}) {
	const { data, isLoading, error } = useQuery(
		orpc.investmentAdvice.plan.queryOptions(),
	);
	const { data: trading } = useQuery(orpc.brokerOrders.status.queryOptions());
	const [transferDone, setTransferDone] = useState(false);
	const transferMinor = data?.plan.transferMinor ?? 0;
	useEffect(() => {
		setTransferDone(transferMinor > 0 && isTransferDone(transferMinor));
	}, [transferMinor]);

	if (isLoading) return <p className="text-sm text-text-muted">Rechne …</p>;
	if (error || !data)
		return (
			<p className="text-sm text-negative">
				Der Vorschlag konnte nicht berechnet werden.
			</p>
		);
	const { plan, reserve } = data;
	const currency = data.baseCurrency;
	const nothing = plan.transferMinor === 0 && plan.buys.length === 0;
	const pot = reservePot(data.bankCashMinor, reserve);

	return (
		<div className="space-y-5">
			<dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
				<dt className="text-text-secondary">Auf den Konten</dt>
				<dd>
					<Money amountMinor={data.bankCashMinor} currency={currency} />
				</dd>
				<dt className="text-text-secondary">Davon bleibt liquide</dt>
				<dd>
					<Money
						amountMinor={Math.min(data.bankCashMinor, plan.keepMinor)}
						currency={currency}
						weight="normal"
					/>
				</dd>
				<dt className="text-text-secondary">Im Depot frei</dt>
				<dd>
					<Money amountMinor={plan.brokerFreeMinor} currency={currency} />
				</dd>
			</dl>
			{pot ? (
				<ReservePot pot={pot} currency={currency} />
			) : (
				<p className="text-xs text-text-muted">Reserve —: {reserve.note}</p>
			)}

			{nothing ? (
				<p className="text-sm text-text-secondary">
					Gerade ist nichts frei anzulegen.
				</p>
			) : null}

			{plan.transferMinor > 0 ? (
				<section className="space-y-2">
					<p className="label-caps">1. Überweisung</p>
					<div
						className={cn(
							"space-y-3 rounded-md border border-border p-3",
							transferDone && "opacity-60",
						)}
					>
						{/* A ticket to carry over to the banking app: the amount large,
						    from and to by name. No IBAN: Fortuna does not show one, and
						    the bank already knows both accounts. */}
						<p className="amount text-2xl font-semibold text-text">
							<Money amountMinor={plan.transferMinor} currency={currency} />
						</p>
						<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
							<dt className="text-text-secondary">Von</dt>
							<dd className="break-words text-text">
								{data.transferFrom?.name ?? "Ihrem Konto"}
							</dd>
							<dt className="text-text-secondary">An</dt>
							<dd className="break-words text-text">{data.depotLabel}</dd>
						</dl>
						<p className="text-xs text-text-secondary">
							Fortuna bewegt kein Geld. Die Überweisung machen Sie selbst bei
							der Bank.
						</p>
						<div className="grid gap-2 sm:flex sm:flex-wrap">
							<Button
								size="lg"
								variant="outline"
								onClick={() => {
									void navigator.clipboard
										.writeText(
											toAmountInput(plan.transferMinor).replace(".", ","),
										)
										.then(() => toast.success("Betrag kopiert"))
										.catch(reportError);
								}}
							>
								<ClipboardCopy /> Betrag kopieren
							</Button>
							<Button
								size="lg"
								variant={transferDone ? "ghost" : "default"}
								disabled={transferDone}
								onClick={() => {
									markTransferDone(plan.transferMinor);
									setTransferDone(true);
									onTransferDone?.();
								}}
							>
								<Check /> {transferDone ? "Erledigt" : "Erledigt melden"}
							</Button>
						</div>
					</div>
				</section>
			) : null}

			{plan.buys.length ? (
				<section className="space-y-2">
					<p className="label-caps">
						{plan.transferMinor > 0 ? "2. Kaufen" : "Kaufen"}
					</p>
					{plan.transferMinor > 0 ? (
						<p className="text-xs text-text-secondary">
							Nach Eingang der Überweisung im Depot.
						</p>
					) : null}
					<ul className="divide-y divide-border rounded-md border border-border">
						{plan.buys.map((buy) => (
							// On a phone: name and amount on one line, the ISIN below,
							// the order button full width under them.
							<li
								key={buy.key}
								className="px-3 py-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-2 sm:py-2"
							>
								<div className="flex min-w-0 flex-1 items-start gap-3 sm:basis-48 sm:items-center">
									<div className="min-w-0 flex-1">
										<p className="break-words text-sm font-medium text-text">
											Kauf {buy.name}
										</p>
										<p className="amount text-xs whitespace-normal text-text-muted">
											{buy.isin} · {BUCKET_LABELS[buy.bucket]}
										</p>
									</div>
									<Money
										amountMinor={buy.amountMinor}
										currency={currency}
										className="shrink-0"
									/>
								</div>
								<Button
									size="sm"
									className="mt-2 w-full sm:mt-0 sm:w-auto"
									disabled={!trading?.connected}
									onClick={() =>
										onBuy({
											side: "buy",
											isin: buy.isin,
											name: buy.name,
											amountMinor: buy.amountMinor,
											approxQuantity: null,
											currency,
										})
									}
								>
									Bei Scalable ausführen
								</Button>
							</li>
						))}
					</ul>
					{trading && !trading.connected ? (
						<p className="text-xs text-text-secondary">
							Zum Ausführen den Handel{" "}
							<Link
								to="/connections"
								search={{
									bank: undefined,
									imported: undefined,
									remise: undefined,
								}}
								className="text-brand hover:underline"
							>
								unter Verbindungen freischalten
							</Link>
							. Oder die Order selbst bei Scalable aufgeben.
						</p>
					) : null}
				</section>
			) : null}

			{plan.findings.length ? (
				<ul className="space-y-1.5">
					{plan.findings.map((finding) => (
						<li
							key={finding.key}
							className={cn(
								"flex gap-2 text-xs",
								finding.tone === "warning"
									? "text-warning"
									: "text-text-secondary",
							)}
						>
							{finding.tone === "warning" ? (
								<CircleAlert className="mt-0.5 size-3.5 shrink-0" />
							) : (
								<Info className="mt-0.5 size-3.5 shrink-0" />
							)}
							<span className="min-w-0">{finding.text}</span>
						</li>
					))}
				</ul>
			) : null}

			<SplitLine targets={data.targets} plan={data} />
		</div>
	);
}

/** "Zielaufteilung: 90 % Aktien / 10 % Cash (ändern)", edited in place. */
function SplitLine({
	targets,
	plan,
}: {
	targets: TargetSplit;
	plan: PlanContext;
}) {
	const invalidate = useInvalidateAll();
	const [editing, setEditing] = useState(false);
	const [values, setValues] = useState<Record<string, string>>({});
	const save = useMutation(
		orpc.hrKoerner.updateProfile.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				setEditing(false);
				toast.success("Zielaufteilung gespeichert");
			},
			onError: reportError,
		}),
	);
	const parsed = BUCKETS.map((key) => {
		const value = Number((values[key] ?? "").replace(",", "."));
		return Number.isFinite(value) ? Math.round(value * 100) : Number.NaN;
	});
	const total = parsed.reduce((sum, value) => sum + value, 0);
	const valid = parsed.every((value) => value >= 0) && total === 10_000;

	if (!editing)
		return (
			<p className="border-t border-border pt-3 text-sm text-text-secondary">
				Zielaufteilung: {describeSplit(targets) || "—"}{" "}
				<button
					type="button"
					className="text-brand hover:underline"
					onClick={() => {
						setValues(
							Object.fromEntries(
								BUCKETS.map((key) => [
									key,
									String(targets[key] / 100).replace(".", ","),
								]),
							),
						);
						setEditing(true);
					}}
				>
					(ändern)
				</button>
				<span className="block text-xs text-text-muted">
					Jetzt: {describeSplit(plan.plan.current) || "—"}
				</span>
			</p>
		);
	return (
		<form
			className="space-y-3 border-t border-border pt-3"
			onSubmit={(event) => {
				event.preventDefault();
				if (!valid) return;
				save.mutate({
					targetEquityBps: parsed[0],
					targetBondBps: parsed[1],
					targetCashBps: parsed[2],
					targetOtherBps: parsed[3],
				});
			}}
		>
			<p className="label-caps">Zielaufteilung in %</p>
			<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
				{BUCKETS.map((key) => (
					<div key={key} className="space-y-1 text-xs text-text-secondary">
						<label htmlFor={`split-${key}`} className="block">
							{BUCKET_LABELS[key]}
						</label>
						<AmountInput
							id={`split-${key}`}
							value={values[key] ?? ""}
							onChange={(event) => {
								const { value } = event.currentTarget;
								setValues((current) => ({ ...current, [key]: value }));
							}}
						/>
					</div>
				))}
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<Button type="submit" size="sm" disabled={!valid || save.isPending}>
					Speichern
				</Button>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					onClick={() => setEditing(false)}
				>
					Abbrechen
				</Button>
				{!valid ? (
					<span className="text-xs text-warning">
						Zusammen {Number.isFinite(total) ? total / 100 : "?"} % statt 100 %
					</span>
				) : null}
			</div>
		</form>
	);
}
