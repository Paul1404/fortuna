import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { InvestmentRulesReminder } from "@/components/investment-rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { AmountInput, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import {
	normaliseSellReason,
	SELL_REASON_MAX,
	SELL_REASON_MIN,
	sellReasonProblem,
} from "@/domain/investment-rules";
import { parseDecimalToMinor } from "@/domain/money";
import { Money, useFormat } from "@/lib/format";
import { reportError, useInvalidateAll } from "@/lib/forms";
import { orpc } from "@/lib/orpc";

export type OrderTicket = {
	side: "buy" | "sell";
	isin: string;
	name: string;
	amountMinor: number;
	approxQuantity: number | null;
	currency: string;
};

type Preview = Awaited<
	ReturnType<typeof import("@/server/services/broker-orders").previewOrder>
>;

/**
 * Placing one order at Scalable, the owner's decision of 26.09.2026: enter
 * the size, see Scalable's whole pre-trade disclosure unchanged, then confirm
 * in a separate step. Nothing is placed before that press.
 *
 * A sale first shows the owner's own investment rules and asks "Warum
 * jetzt?" in one sentence (the decision of 28.09.2026); only then can the
 * preview be requested. The sentence is stored with the order. Buys are
 * unchanged.
 */
export function BrokerOrderDialog({
	ticket,
	onClose,
}: {
	ticket: OrderTicket;
	onClose: () => void;
}) {
	const f = useFormat();
	const invalidate = useInvalidateAll();
	const { data: trading } = useQuery(orpc.brokerOrders.status.queryOptions());
	const isSell = ticket.side === "sell";
	const { data: rules } = useQuery({
		...orpc.hrKoerner.investmentRules.queryOptions(),
		enabled: isSell,
	});
	const [reason, setReason] = useState("");
	const reasonMissing = isSell && sellReasonProblem(reason) !== null;
	const [amount, setAmount] = useState(
		(ticket.amountMinor / 100).toFixed(2).replace(".", ","),
	);
	const [shares, setShares] = useState(
		ticket.approxQuantity !== null
			? String(Math.floor(ticket.approxQuantity * 10_000) / 10_000).replace(
					".",
					",",
				)
			: "",
	);
	const [preview, setPreview] = useState<Preview | null>(null);
	const [acknowledged, setAcknowledged] = useState(false);
	const [disclosureRead, setDisclosureRead] = useState(false);
	const [done, setDone] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const previewMutation = useMutation(
		orpc.brokerOrders.preview.mutationOptions({
			onSuccess: (result) => {
				setPreview(result);
				setError(null);
			},
			onError: (err) => setError(err.message),
		}),
	);
	const submitMutation = useMutation(
		orpc.brokerOrders.submit.mutationOptions({
			onSuccess: async () => {
				setDone(true);
				setError(null);
				await invalidate();
			},
			onError: async (err) => {
				setError(err.message);
				await invalidate();
			},
		}),
	);
	const discard = useMutation(orpc.brokerOrders.discard.mutationOptions());

	const close = () => {
		if (preview && !done) discard.mutate({ orderId: preview.orderId });
		onClose();
	};

	const requestPreview = () => {
		setError(null);
		if (ticket.side === "buy") {
			const minor = parseDecimalToMinor(amount);
			if (minor === null || minor < 100) {
				setError("Bitte einen Betrag ab 1,00 € eingeben.");
				return;
			}
			previewMutation.mutate({
				side: "buy",
				isin: ticket.isin,
				amountMinor: minor,
			});
		} else {
			const count = Number(shares.replace(",", "."));
			if (!Number.isFinite(count) || count <= 0) {
				setError("Bitte eine Stückzahl größer als null eingeben.");
				return;
			}
			const reasonRefusal = sellReasonProblem(reason);
			if (reasonRefusal) {
				setError(reasonRefusal);
				return;
			}
			previewMutation.mutate({
				side: "sell",
				isin: ticket.isin,
				shares: count,
				reason,
			});
		}
	};

	const confirmLabel = preview
		? preview.side === "buy"
			? `Jetzt für ${f.money(preview.amountMinor ?? 0, preview.currency)} kaufen`
			: `Jetzt ${f.number(preview.shares ?? 0, 4)} Stück verkaufen`
		: "";

	const submit = () => {
		if (!preview) return;
		// The preview was the first step; this is the owner's explicit yes.
		if (
			!window.confirm(
				`${confirmLabel.replace("Jetzt ", "")}: ${preview.instrumentName} (${preview.isin}) wirklich bei Scalable ausführen?`,
			)
		)
			return;
		submitMutation.mutate({ orderId: preview.orderId, acknowledged });
	};

	return (
		<Dialog open onOpenChange={(open) => !open && close()}>
			<DialogContent
				title={`${ticket.side === "buy" ? "Kaufen" : "Verkaufen"}: ${ticket.name}`}
				description="Scalable berechnet die Order; ausgeführt wird sie erst nach Ihrer Bestätigung."
				className="max-w-2xl"
			>
				{trading && !trading.connected ? (
					<p className="text-sm text-text-secondary">
						Der Handel ist noch nicht freigeschaltet.{" "}
						<Link
							to="/connections"
							search={{
								bank: undefined,
								imported: undefined,
								remise: undefined,
							}}
							className="text-brand hover:underline"
						>
							Unter Verbindungen freischalten
						</Link>
						.
					</p>
				) : done ? (
					<>
						<p className="text-sm text-text">
							Übermittelt. Scalable führt die Order aus; der Depotabgleich zeigt
							sie in Kürze.
						</p>
						<DialogFooter>
							<Button onClick={onClose}>Schließen</Button>
						</DialogFooter>
					</>
				) : !preview ? (
					<>
						<p className="amount text-xs text-text-muted">{ticket.isin}</p>
						{isSell && rules ? (
							<InvestmentRulesReminder rules={rules.rules} />
						) : null}
						<div className="space-y-1">
							<label
								htmlFor="broker-order-size"
								className="block text-xs text-text-secondary"
							>
								{ticket.side === "buy"
									? `Betrag in ${ticket.currency}`
									: "Stückzahl"}
							</label>
							<AmountInput
								id="broker-order-size"
								value={ticket.side === "buy" ? amount : shares}
								onChange={(event) => {
									const { value } = event.currentTarget;
									if (ticket.side === "buy") setAmount(value);
									else setShares(value);
								}}
							/>
						</div>
						{isSell ? (
							<Field
								label="Warum jetzt?"
								htmlFor="broker-order-reason"
								hint={`Ein Satz in Ihren Worten, mindestens ${SELL_REASON_MIN} Zeichen. Er wird mit der Order gespeichert.`}
							>
								<Textarea
									id="broker-order-reason"
									rows={2}
									maxLength={SELL_REASON_MAX}
									value={reason}
									onChange={(event) => {
										const { value } = event.currentTarget;
										setReason(value);
									}}
									placeholder="Ich verkaufe jetzt, weil …"
								/>
							</Field>
						) : null}
						{error ? <p className="text-sm text-negative">{error}</p> : null}
						<DialogFooter>
							<Button variant="ghost" onClick={onClose}>
								Abbrechen
							</Button>
							<Button
								onClick={requestPreview}
								disabled={previewMutation.isPending || reasonMissing}
							>
								{previewMutation.isPending
									? "Scalable rechnet …"
									: "Vorschau von Scalable holen"}
							</Button>
						</DialogFooter>
					</>
				) : (
					<>
						{isSell ? (
							<p className="break-words text-sm text-text-secondary">
								Warum jetzt: „{normaliseSellReason(reason)}“
							</p>
						) : null}
						<p className="text-xs text-text-secondary">
							Vollständige Angaben von Scalable, unverändert. Gültig bis{" "}
							{f.dateTime(preview.expiresAt)}.
						</p>
						<Disclosure
							sections={preview.disclosure}
							onRead={() => setDisclosureRead(true)}
						/>
						{preview.requiresAcknowledgement ? (
							<label className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-bg p-3 text-sm text-warning">
								<input
									type="checkbox"
									className="mt-0.5 shrink-0"
									checked={acknowledged}
									onChange={(event) => {
										const { checked } = event.currentTarget;
										setAcknowledged(checked);
									}}
								/>
								<span>
									Ich habe den Warnhinweis oben gelesen und möchte die Order
									trotzdem ausführen.
								</span>
							</label>
						) : null}
						{!preview.tradable ? (
							<p className="text-sm text-negative">
								Laut Scalable ist das Wertpapier gerade nicht handelbar.
							</p>
						) : null}
						{error ? <p className="text-sm text-negative">{error}</p> : null}
						<DialogFooter>
							{!disclosureRead ? (
								<p className="basis-full text-xs text-text-secondary">
									Bestätigen geht erst, wenn alle Abschnitte geöffnet und bis
									zum Ende gelesen sind.
								</p>
							) : null}
							<Button variant="ghost" onClick={close}>
								Verwerfen
							</Button>
							<Button
								onClick={submit}
								className="h-auto min-h-8 whitespace-normal py-1.5"
								disabled={
									!disclosureRead ||
									submitMutation.isPending ||
									!preview.tradable ||
									(preview.requiresAcknowledgement && !acknowledged)
								}
							>
								{submitMutation.isPending ? "Wird übermittelt …" : confirmLabel}
							</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

type DisclosureSection = Preview["disclosure"][number];

/**
 * Scalable's pre-trade disclosure, one collapsible section per topic, every
 * row inside unchanged. The rule `pre_trade_full_disclosure_v1` allows no
 * field to be left out, so folding is only a reading aid and the owner must
 * actually see it all: `onRead` fires once every section has been open and
 * the end of the disclosure has been on screen. From `sm` up the sections
 * start open; on a phone they start closed, so the page is not one endless
 * list, and "Alle öffnen" opens them in one go.
 */
function Disclosure({
	sections,
	onRead,
}: {
	sections: DisclosureSection[];
	onRead: () => void;
}) {
	const [open, setOpen] = useState<Set<string>>(() =>
		typeof window !== "undefined" &&
		window.matchMedia("(min-width: 40rem)").matches
			? new Set(sections.map((section) => section.key))
			: new Set(sections.slice(0, 1).map((section) => section.key)),
	);
	const [seen, setSeen] = useState<Set<string>>(() => new Set(open));
	const [endSeen, setEndSeen] = useState(false);
	const endRef = useRef<HTMLDivElement>(null);
	const allSeen = sections.every((section) => seen.has(section.key));

	// The end counts only once every section is open, and only when it is
	// above the sticky footer rather than merely inside the viewport under
	// it: the confirm button must not unlock on a disclosure scrolled past
	// behind the footer.
	useEffect(() => {
		const marker = endRef.current;
		if (!allSeen || endSeen || !marker) return;
		const scroller = marker.closest<HTMLElement>("[data-slot=dialog-content]");
		const check = () => {
			const footer = scroller?.querySelector("[data-slot=dialog-footer]");
			const limit = Math.min(
				footer?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
				scroller?.getBoundingClientRect().bottom ?? window.innerHeight,
				window.innerHeight,
			);
			if (marker.getBoundingClientRect().bottom <= limit + 1) setEndSeen(true);
		};
		const frame = requestAnimationFrame(check);
		const target: HTMLElement | Window = scroller ?? window;
		target.addEventListener("scroll", check, { passive: true });
		window.addEventListener("resize", check);
		return () => {
			cancelAnimationFrame(frame);
			target.removeEventListener("scroll", check);
			window.removeEventListener("resize", check);
		};
	}, [allSeen, endSeen]);
	useEffect(() => {
		if (allSeen && endSeen) onRead();
	}, [allSeen, endSeen, onRead]);

	const toggle = (key: string, isOpen: boolean) => {
		setOpen((current) => {
			const next = new Set(current);
			if (isOpen) next.add(key);
			else next.delete(key);
			return next;
		});
		if (isOpen) setSeen((current) => new Set(current).add(key));
	};

	return (
		<div className="space-y-2">
			{open.size < sections.length ? (
				<div className="flex flex-wrap items-center justify-between gap-2">
					<p className="text-xs text-text-muted">
						{seen.size} von {sections.length} Abschnitten geöffnet
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => {
							const all = new Set(sections.map((section) => section.key));
							setOpen(all);
							setSeen(new Set(all));
						}}
					>
						Alle öffnen
					</Button>
				</div>
			) : null}
			{sections.map((section) => (
				<details
					key={section.key}
					open={open.has(section.key)}
					onToggle={(event) => {
						const isOpen = event.currentTarget.open;
						if (isOpen !== open.has(section.key)) toggle(section.key, isOpen);
					}}
					className="group rounded-md border border-border"
				>
					<summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
						<span className="min-w-0">
							<span className="label-caps block text-text-secondary">
								{section.title}
							</span>
							<span className="text-[11px] text-text-muted">
								{section.rows.length === 1
									? "1 Angabe"
									: `${section.rows.length} Angaben`}
								{seen.has(section.key) ? "" : " · noch nicht geöffnet"}
							</span>
						</span>
						<ChevronDown
							aria-hidden
							className="size-4 shrink-0 text-text-muted transition-transform group-open:rotate-180"
						/>
					</summary>
					<dl className="divide-y divide-border border-t border-border text-sm">
						{section.rows.map((row) => (
							<div
								key={row.path}
								className="grid gap-0.5 px-3 py-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-1 sm:py-1.5"
							>
								<dt className="text-xs text-text-secondary">{row.label}</dt>
								<dd className="min-w-0 break-words [overflow-wrap:anywhere]">
									{row.lines.map((line, index) => (
										<span key={index} className="block whitespace-pre-wrap">
											{line}
										</span>
									))}
								</dd>
							</div>
						))}
					</dl>
				</details>
			))}
			<div ref={endRef} aria-hidden className="h-px" />
		</div>
	);
}

const STATUS_LABELS: Record<string, string> = {
	previewed: "Vorschau",
	submitting: "Wird übermittelt",
	submitted: "Übermittelt",
	failed: "Fehlgeschlagen",
	expired: "Verworfen",
};

/** Every order Fortuna previewed or placed, newest first. */
export function OrderLogCard() {
	const f = useFormat();
	const { data } = useQuery(orpc.brokerOrders.list.queryOptions());
	if (!data?.length) return null;
	return (
		<Card>
			<CardHeader
				title="Orderprotokoll"
				subtitle="Jede Order, die Fortuna bei Scalable berechnet oder ausgeführt hat."
			/>
			<CardBody>
				<ul className="divide-y divide-border">
					{data.map((order) => (
						<li
							key={order.id}
							className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
						>
							<div className="min-w-0 flex-1">
								<p className="text-sm">
									{order.side === "buy" ? "Kauf" : "Verkauf"}{" "}
									{order.instrumentName}
								</p>
								<p className="amount text-xs text-text-muted">
									{order.isin} · {f.dateTime(order.createdAt)}
									{order.errorCode ? ` · ${order.errorCode}` : ""}
								</p>
								{order.sellReason ? (
									<p className="mt-0.5 break-words text-xs text-text-secondary">
										Warum jetzt: „{order.sellReason}“
									</p>
								) : null}
							</div>
							{order.amountMinor !== null ? (
								<Money
									amountMinor={order.amountMinor}
									currency={order.currency}
								/>
							) : order.shares !== null ? (
								<span className="amount text-sm">
									{f.number(order.shares, 4)} Stück
								</span>
							) : null}
							<Badge
								variant={
									order.status === "submitted"
										? "positive"
										: order.status === "failed"
											? "warning"
											: "default"
								}
							>
								{STATUS_LABELS[order.status] ?? "—"}
							</Badge>
						</li>
					))}
				</ul>
			</CardBody>
		</Card>
	);
}

/**
 * The separate trading login on the Scalable card. Reading stays on the
 * read-only connection; this session is used for nothing but confirmed
 * orders, and "Handel sperren" logs it out at Scalable.
 */
export function TradingAccessSection() {
	const invalidate = useInvalidateAll();
	const { data: status } = useQuery({
		...orpc.brokerOrders.status.queryOptions(),
		refetchInterval: (query) =>
			query.state.data?.status === "pending" ? 3_000 : false,
	});
	const [prompt, setPrompt] = useState<{ url: string; code: string } | null>(
		null,
	);
	const begin = useMutation(
		orpc.brokerOrders.beginLogin.mutationOptions({
			onSuccess: async (result) => {
				setPrompt(result);
				await invalidate();
			},
			onError: reportError,
		}),
	);
	const lock = useMutation(
		orpc.brokerOrders.disconnect.mutationOptions({
			onSuccess: () => invalidate(),
			onError: reportError,
		}),
	);
	if (!status) return null;
	return (
		<div className="space-y-2 rounded-md border border-border p-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="font-medium">Handel</span>
				<Badge variant={status.connected ? "positive" : "default"}>
					{status.connected
						? "freigeschaltet"
						: status.status === "pending"
							? "Freigabe läuft"
							: "gesperrt"}
				</Badge>
			</div>
			<p className="text-xs text-text-secondary">
				Eine eigene Scalable-Freigabe nur für Orders. Fortuna führt eine Order
				ausschließlich aus, nachdem Sie Scalables vollständige Vorschau gesehen
				und bestätigt haben – nur für Wertpapiere im Depot, nie von selbst.
			</p>
			<div className="flex flex-wrap gap-2">
				{status.connected ? (
					<Button
						type="button"
						variant="ghost"
						disabled={lock.isPending}
						onClick={() => {
							if (
								confirm(
									"Handel sperren? Die Handelsfreigabe wird bei Scalable abgemeldet; das Lesen bleibt verbunden.",
								)
							)
								lock.mutate(undefined);
						}}
					>
						Handel sperren
					</Button>
				) : (
					<Button
						type="button"
						variant="outline"
						disabled={begin.isPending}
						onClick={() => begin.mutate(undefined)}
					>
						{status.status === "pending"
							? "Anmeldecode anzeigen"
							: "Handel freischalten"}
					</Button>
				)}
			</div>
			{status.lastError ? (
				<p className="text-xs text-negative">{status.lastError}</p>
			) : null}
			<Dialog
				open={Boolean(prompt)}
				onOpenChange={(open) => {
					if (!open) setPrompt(null);
				}}
			>
				<DialogContent
					title="Handel bei Scalable freischalten"
					description="Öffnen Sie die Scalable-Anmeldeseite und bestätigen Sie diesen Gerätecode selbst."
				>
					<p className="text-sm text-text-secondary">
						Diese Freigabe darf Orders ausführen. Fortuna nutzt sie nur, wenn
						Sie eine Order nach Scalables Vorschau bestätigen. Fortuna sieht
						weder Passwort noch 2FA-Code.
					</p>
					<p className="rounded-md border border-border bg-surface-sunken p-3 font-mono text-lg tracking-widest">
						{prompt?.code}
					</p>
					{prompt ? (
						<Button asChild>
							<a href={prompt.url} target="_blank" rel="noopener noreferrer">
								Scalable-Anmeldung öffnen
							</a>
						</Button>
					) : null}
				</DialogContent>
			</Dialog>
		</div>
	);
}
