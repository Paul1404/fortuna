import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowDown,
	ArrowLeftRight,
	ArrowUp,
	Pencil,
	Scale,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	CashEntryDialog,
	type CashEntryMode,
} from "@/components/cash-account-actions";
import { LineChart } from "@/components/charts/line-chart";
import {
	HeroAction,
	HeroActions,
	HeroLabel,
	HeroPanel,
} from "@/components/hero-panel";
import { StatRow, StatTile } from "@/components/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { todayIso } from "@/domain/dates";
import { Money, useFormat } from "@/lib/format";
import {
	amount,
	CURRENCIES,
	optStr,
	reportError,
	str,
	toAmountInput,
	useInvalidateAll,
} from "@/lib/forms";
import { ACCOUNT_TYPE_LABELS, SYNC_STATUS_LABELS } from "@/lib/labels";
import { orpc } from "@/lib/orpc";
import { ACCOUNT_TYPES } from "@/lib/schemas";
import { cn } from "@/lib/utils";

const TRANSACTION_PAGE_SIZE = 50;

export const Route = createFileRoute("/_app/accounts/$id")({
	validateSearch: (raw: Record<string, unknown>): { page?: number } => {
		const page = Number(raw.page);
		return {
			page:
				Number.isSafeInteger(page) && page > 1 && page <= 2000
					? page
					: undefined,
		};
	},
	loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
	loader: async ({ context, params, deps }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(
				orpc.accounts.get.queryOptions({ input: { id: params.id } }),
			),
			context.queryClient.ensureQueryData(
				orpc.accounts.balanceHistory.queryOptions({
					input: { id: params.id, months: 12 },
				}),
			),
			context.queryClient.ensureQueryData(
				orpc.transactions.list.queryOptions({
					input: {
						accountId: params.id,
						limit: TRANSACTION_PAGE_SIZE,
						offset: (deps.page - 1) * TRANSACTION_PAGE_SIZE,
					},
				}),
			),
		]);
	},
	head: () => ({ meta: [{ title: "Konto · Fortuna" }] }),
	component: AccountDetail,
});

function AccountDetail() {
	const { id } = Route.useParams();
	const { page: searchPage } = Route.useSearch();
	const page = searchPage ?? 1;
	const { data: account } = useSuspenseQuery(
		orpc.accounts.get.queryOptions({ input: { id } }),
	);
	const { data: history } = useSuspenseQuery(
		orpc.accounts.balanceHistory.queryOptions({ input: { id, months: 12 } }),
	);
	const { data: txs } = useSuspenseQuery(
		orpc.transactions.list.queryOptions({
			input: {
				accountId: id,
				limit: TRANSACTION_PAGE_SIZE,
				offset: (page - 1) * TRANSACTION_PAGE_SIZE,
			},
		}),
	);
	const transactionPages = Math.max(
		1,
		Math.ceil(txs.total / TRANSACTION_PAGE_SIZE),
	);
	const f = useFormat();
	const navigate = useNavigate();
	const invalidate = useInvalidateAll();
	const [edit, setEdit] = useState(false);
	const [balanceOpen, setBalanceOpen] = useState(false);
	const [cashEntry, setCashEntry] = useState<CashEntryMode | null>(null);
	const isWallet = account.type === "cash" && account.isActive;

	const update = useMutation(
		orpc.accounts.update.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Konto aktualisiert");
				setEdit(false);
			},
			onError: reportError,
		}),
	);
	const record = useMutation(
		orpc.accounts.recordBalance.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Kontostand erfasst");
				setBalanceOpen(false);
			},
			onError: reportError,
		}),
	);
	const first = history[0];
	const change = first
		? account.currentBalanceMinor - first.balanceMinor
		: null;

	return (
		<div className="space-y-5">
			<HeroPanel className="px-4 py-6 sm:px-7 sm:py-7">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div className="min-w-0">
						<h1 className="font-display text-[26px] font-normal leading-tight tracking-[-0.01em] text-hero-text">
							{account.name}
						</h1>
						<span className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-hero-muted">
							<Link to="/accounts" className="text-glow hover:underline">
								Konten
							</Link>
							<span>·</span>
							{account.institution ?? "—"} · {ACCOUNT_TYPE_LABELS[account.type]}{" "}
							· {account.currency}
							{account.iban ? (
								<span className="font-mono text-xs">{account.iban}</span>
							) : null}
							<Badge
								variant={
									account.syncStatus === "synced" ? "positive" : "default"
								}
							>
								{SYNC_STATUS_LABELS[account.syncStatus]}
							</Badge>
							{!account.isActive ? (
								<Badge variant="warning">inaktiv</Badge>
							) : null}
						</span>
					</div>
				</div>
				<div className="mt-7 flex flex-col items-center gap-7 sm:flex-row sm:items-end sm:justify-between">
					<div className="min-w-0 max-sm:text-center">
						<HeroLabel>Saldo</HeroLabel>
						<p
							className={cn(
								"amount mt-2 max-w-full overflow-x-auto text-[clamp(1.75rem,8vw,2.5rem)] font-semibold leading-none tracking-[-0.02em] text-hero-text",
								account.currentBalanceMinor < 0 && "text-negative",
							)}
						>
							<Money
								amountMinor={account.currentBalanceMinor}
								currency={account.currency}
								animate
							/>
						</p>
						<p className="mt-2 text-[11px] text-hero-muted">
							Stand {account.balanceAsOf ? f.date(account.balanceAsOf) : "—"}
						</p>
					</div>
					<HeroActions className="max-sm:w-full">
						{isWallet ? (
							// A wallet's daily jobs, one tap from its page: the spend,
							// the money coming in, and the count.
							<>
								<HeroAction
									icon={ArrowDown}
									label="Ausgabe"
									onClick={() => setCashEntry("outflow")}
								/>
								<HeroAction
									icon={ArrowUp}
									label="Einnahme"
									onClick={() => setCashEntry("inflow")}
								/>
								<HeroAction
									icon={Scale}
									label="Zählen"
									onClick={() => setCashEntry("count")}
								/>
							</>
						) : (
							<>
								<HeroAction
									icon={Scale}
									label="Kontostand"
									onClick={() => setBalanceOpen(true)}
								/>
								<HeroAction
									icon={ArrowLeftRight}
									label="Umsätze"
									to="/transactions"
									search={{ accountId: id }}
								/>
							</>
						)}
						<HeroAction
							icon={Pencil}
							label="Bearbeiten"
							onClick={() => setEdit(true)}
						/>
					</HeroActions>
				</div>
			</HeroPanel>
			<StatRow className="xl:grid-cols-3">
				<StatTile
					label="Veränderung in 12 Monaten"
					value={
						change === null ? (
							"—"
						) : (
							<Money
								amountMinor={change}
								currency={account.currency}
								tone="auto"
								signed
								className="text-[22px]"
							/>
						)
					}
					detail={
						first ? (
							<span className="text-text-muted">seit {f.date(first.date)}</span>
						) : null
					}
				/>
				<StatTile
					label="Transaktionen"
					value={String(txs.total)}
					detail={
						<Link
							to="/transactions"
							search={{ accountId: id }}
							className="text-brand hover:underline"
						>
							In Transaktionen öffnen
						</Link>
					}
				/>
				{account.type === "credit_card" && account.creditLimitMinor ? (
					<StatTile
						label="Genutzter Kreditrahmen"
						value={f
							.percent(
								(Math.max(0, -account.currentBalanceMinor) /
									account.creditLimitMinor) *
									100,
							)
							.replace("+", "")}
						detail={
							<span className="text-text-muted">
								Limit {f.money(account.creditLimitMinor, account.currency)}
							</span>
						}
					/>
				) : (
					<StatTile
						label="Im Nettovermögen"
						value={
							account.includeInNetWorth && account.isActive ? "Ja" : "Nein"
						}
						detail={
							<span className="text-text-muted">
								{account.isActive
									? (account.notes ?? "")
									: "Konto ist nicht aktiv und zählt deshalb nicht mit."}
							</span>
						}
					/>
				)}
			</StatRow>
			{isWallet && cashEntry ? (
				<CashEntryDialog
					account={account}
					mode={cashEntry}
					onClose={() => setCashEntry(null)}
				/>
			) : null}
			<Card>
				<CardHeader
					title="Saldoverlauf"
					subtitle="Erfasste Kontostände zusammen mit den gebuchten Transaktionen"
				/>
				<CardBody>
					<LineChart
						ariaLabel={`Saldoverlauf von ${account.name}`}
						series={[
							{
								key: "b",
								label: "Saldo",
								points: history.map((h) => ({ x: h.date, y: h.balanceMinor })),
								area: true,
							},
						]}
						currency={account.currency}
						height={220}
						// Ticks a year apart, printed as day and month with no year,
						// read as if the chart ran backwards through the calendar:
						// "18. Sept · 18. Aug · 18. Juli" on a line rising to 2036.
						xLabel={(x, _index, all) =>
							(all.at(-1) ?? "").slice(0, 4) !== (all[0] ?? "").slice(0, 4)
								? f.date(x, "month")
								: f.date(x, "short")
						}
					/>
				</CardBody>
			</Card>
			<Card>
				<CardHeader
					title={`Transaktionen (${txs.total})`}
					subtitle="Gesamte Kontohistorie, seitenweise durchblätterbar"
					action={
						<Link
							to="/transactions"
							search={{ accountId: id }}
							className="text-xs text-brand hover:underline"
						>
							In der Gesamtübersicht öffnen
						</Link>
					}
				/>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Datum</TableHead>
							<TableHead>Händler</TableHead>
							<TableHead className="hidden md:table-cell">Kategorie</TableHead>
							<TableHead className="text-right">Betrag</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{txs.rows.map((t) => (
							<TableRow
								key={t.id}
								onActivate={() =>
									navigate({
										to: "/transactions",
										search: { accountId: id, highlight: t.id },
									})
								}
							>
								<TableCell className="font-mono text-xs text-text-muted">
									{f.date(t.bookingDate, "short")}
								</TableCell>
								<TableCell className="max-w-[320px] break-words">
									{t.merchantName ?? t.description}
								</TableCell>
								<TableCell className="hidden text-text-secondary md:table-cell">
									{t.categoryName ?? "—"}
								</TableCell>
								<TableCell className="text-right">
									<Money
										amountMinor={t.amountMinor}
										currency={t.currency}
										tone={t.amountMinor > 0 ? "positive" : "default"}
									/>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
				{transactionPages > 1 ? (
					<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs text-text-secondary">
						<span>
							Seite {page} von {transactionPages}
						</span>
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={page <= 1}
								onClick={() =>
									navigate({
										to: "/accounts/$id",
										params: { id },
										search: { page: page - 1 > 1 ? page - 1 : undefined },
									})
								}
							>
								Zurück
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={page >= transactionPages}
								onClick={() =>
									navigate({
										to: "/accounts/$id",
										params: { id },
										search: { page: page + 1 },
									})
								}
							>
								Weiter
							</Button>
						</div>
					</div>
				) : null}
			</Card>

			<Dialog open={edit} onOpenChange={setEdit}>
				<DialogContent title="Konto bearbeiten">
					<form
						onSubmit={(e) => {
							e.preventDefault();
							const form = new FormData(e.currentTarget);
							update.mutate({
								id,
								name: str(form, "name"),
								institution: optStr(form, "institution"),
								type: str(form, "type") as (typeof ACCOUNT_TYPES)[number],
								currency: str(form, "currency"),
								iban: optStr(form, "iban"),
								creditLimitMinor: amount(form, "creditLimit"),
								includeInNetWorth: form.get("includeInNetWorth") === "on",
								isActive: form.get("isActive") === "on",
								notes: optStr(form, "notes"),
							});
						}}
						className="grid gap-3 sm:grid-cols-2"
					>
						<Field label="Name" htmlFor="e-name" className="sm:col-span-2">
							<Input
								id="e-name"
								name="name"
								defaultValue={account.name}
								required
							/>
						</Field>
						<Field label="Institut" htmlFor="e-inst">
							<Input
								id="e-inst"
								name="institution"
								defaultValue={account.institution ?? ""}
							/>
						</Field>
						<Field label="Typ" htmlFor="e-type">
							<NativeSelect id="e-type" name="type" defaultValue={account.type}>
								{ACCOUNT_TYPES.map((t) => (
									<option key={t} value={t}>
										{ACCOUNT_TYPE_LABELS[t]}
									</option>
								))}
							</NativeSelect>
						</Field>
						<Field label="Währung" htmlFor="e-cur">
							<NativeSelect
								id="e-cur"
								name="currency"
								defaultValue={account.currency}
							>
								{CURRENCIES.map((c) => (
									<option key={c}>{c}</option>
								))}
							</NativeSelect>
						</Field>
						<Field label="IBAN" htmlFor="e-iban">
							<Input
								id="e-iban"
								name="iban"
								defaultValue={account.iban ?? ""}
								className="font-mono"
							/>
						</Field>
						<Field label="Kreditrahmen" htmlFor="e-limit">
							<Input
								id="e-limit"
								name="creditLimit"
								defaultValue={toAmountInput(account.creditLimitMinor)}
								inputMode="decimal"
								className="amount"
							/>
						</Field>
						<div className="flex flex-col gap-2 text-xs text-text-secondary sm:col-span-2">
							<label className="flex items-center gap-2">
								<input
									type="checkbox"
									name="includeInNetWorth"
									defaultChecked={account.includeInNetWorth}
									className="accent-brand"
								/>{" "}
								Im Nettovermögen berücksichtigen
							</label>
							<label className="flex items-center gap-2">
								<input
									type="checkbox"
									name="isActive"
									defaultChecked={account.isActive}
									className="accent-brand"
								/>{" "}
								Aktiv — ein inaktives Konto verschwindet aus der Kontenliste und
								zählt nicht mehr zum Nettovermögen
							</label>
						</div>
						<Field label="Notizen" htmlFor="e-notes" className="sm:col-span-2">
							<Textarea
								id="e-notes"
								name="notes"
								defaultValue={account.notes ?? ""}
								rows={2}
							/>
						</Field>
						<div className="flex justify-end gap-2 sm:col-span-2">
							<Button
								type="button"
								variant="ghost"
								onClick={() => setEdit(false)}
							>
								Abbrechen
							</Button>
							<Button type="submit" disabled={update.isPending}>
								Speichern
							</Button>
						</div>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={balanceOpen} onOpenChange={setBalanceOpen}>
				<DialogContent
					title="Kontostand erfassen"
					description="Ein abgelesener Kontostand zu einem Datum. Der neueste wird zum aktuellen Saldo; ältere Werte verankern den Verlauf."
				>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							const form = new FormData(e.currentTarget);
							const value = amount(form, "balance");
							if (value === null) return toast.error("Kontostand eingeben");
							record.mutate({
								accountId: id,
								date: str(form, "date"),
								balanceMinor: value,
							});
						}}
						className="grid gap-3 sm:grid-cols-2"
					>
						<Field label="Datum" htmlFor="b-date">
							<Input
								id="b-date"
								name="date"
								type="date"
								defaultValue={todayIso()}
								required
							/>
						</Field>
						<Field label={`Saldo (${account.currency})`} htmlFor="b-bal">
							<Input
								id="b-bal"
								name="balance"
								inputMode="decimal"
								defaultValue={toAmountInput(account.currentBalanceMinor)}
								required
								className="amount"
								autoFocus
							/>
						</Field>
						<div className="flex justify-end gap-2 sm:col-span-2">
							<Button
								type="button"
								variant="ghost"
								onClick={() => setBalanceOpen(false)}
							>
								Abbrechen
							</Button>
							<Button type="submit" disabled={record.isPending}>
								Erfassen
							</Button>
						</div>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
