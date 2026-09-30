import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
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
	useInvalidateAll,
} from "@/lib/forms";
import { ACCOUNT_TYPE_LABELS, SYNC_STATUS_LABELS } from "@/lib/labels";
import { orpc } from "@/lib/orpc";
import { ACCOUNT_TYPES } from "@/lib/schemas";

export const Route = createFileRoute("/_app/accounts/")({
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(
				orpc.accounts.list.queryOptions({ input: { includeInactive: true } }),
			),
			context.queryClient.ensureQueryData(
				orpc.investments.sourceAccounts.queryOptions(),
			),
		]),
	head: () => ({ meta: [{ title: "Konten & Depots · Fortuna" }] }),
	component: AccountsPage,
});

function AccountsPage() {
	const { data: accounts } = useSuspenseQuery(
		orpc.accounts.list.queryOptions({ input: { includeInactive: true } }),
	);
	const { data: depots } = useSuspenseQuery(
		orpc.investments.sourceAccounts.queryOptions(),
	);
	const { data: settings } = useSuspenseQuery(orpc.settings.get.queryOptions());
	const f = useFormat();
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const active = accounts.filter((a) => a.isActive);
	const inactive = accounts.filter((a) => !a.isActive);
	const byCurrency = new Map<string, number>();
	for (const a of active)
		byCurrency.set(
			a.currency,
			(byCurrency.get(a.currency) ?? 0) + a.currentBalanceMinor,
		);

	return (
		<div className="space-y-5">
			<PageHeader
				title="Konten & Depots"
				subtitle={`${active.length} Konten${depots.length ? ` · ${depots.length} verbundene Depots` : ""} · Salden wie erfasst oder synchronisiert`}
				actions={
					<Button onClick={() => setOpen(true)}>
						<Plus /> Konto hinzufügen
					</Button>
				}
			/>
			<Card>
				{active.length === 0 ? (
					<EmptyState
						title="Noch keine Bank- oder Bargeldkonten"
						description="Füge ein Girokonto, Sparkonto, eine Kreditkarte oder Bargeld hinzu. Depots stehen separat darunter."
						action={
							<Button onClick={() => setOpen(true)}>Konto hinzufügen</Button>
						}
					/>
				) : (
					<>
						{/* A phone gets one line per account, the whole line a link:
						    the table squeezed name and balance into two narrow
						    columns beside an empty third. */}
						<ul className="sm:hidden">
							{active.map((a) => (
								<li
									key={a.id}
									className="border-b border-border last:border-b-0"
								>
									<Link
										to="/accounts/$id"
										params={{ id: a.id }}
										className="flex min-h-14 items-center gap-3 px-4 py-3 outline-none hover:bg-surface-sunken/50 focus-visible:bg-surface-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
									>
										<span className="min-w-0 flex-1">
											<span className="block break-words text-sm font-medium text-text">
												{a.name}
											</span>
											<span className="mt-0.5 block break-words text-xs text-text-muted">
												{[a.institution, ACCOUNT_TYPE_LABELS[a.type] ?? "—"]
													.filter(Boolean)
													.join(" · ")}
											</span>
										</span>
										<span className="shrink-0 text-right">
											<Money
												amountMinor={a.currentBalanceMinor}
												currency={a.currency}
												tone={
													a.currentBalanceMinor < 0 ? "negative" : "default"
												}
												className="block text-sm"
											/>
											<span className="mt-0.5 block text-[11px] text-text-muted">
												{a.balanceAsOf
													? `Stand ${f.date(a.balanceAsOf, "short")}`
													: "ohne Stand"}
											</span>
										</span>
										<ChevronRight
											className="size-4 shrink-0 text-text-muted"
											aria-hidden
										/>
									</Link>
								</li>
							))}
						</ul>
						<div className="hidden sm:block">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Konto</TableHead>
										<TableHead className="hidden md:table-cell">Typ</TableHead>
										<TableHead className="hidden lg:table-cell">
											Abgleich
										</TableHead>
										<TableHead className="hidden lg:table-cell">
											Letzte Aktivität
										</TableHead>
										<TableHead className="text-right">Transaktionen</TableHead>
										<TableHead className="text-right">Saldo</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{active.map((a) => (
										<TableRow
											key={a.id}
											onActivate={() =>
												navigate({ to: "/accounts/$id", params: { id: a.id } })
											}
										>
											<TableCell>
												<span className="font-medium text-text">{a.name}</span>
												<span className="block break-words text-[11px] text-text-muted">
													{a.institution ?? "—"}
													{a.iban ? (
														<span className="ml-2 break-all font-mono">
															{a.iban.replace(/(.{4})/g, "$1 ").trim()}
														</span>
													) : null}
												</span>
											</TableCell>
											<TableCell className="hidden text-text-secondary md:table-cell">
												{ACCOUNT_TYPE_LABELS[a.type]}
											</TableCell>
											<TableCell className="hidden lg:table-cell">
												<Badge
													variant={
														a.syncStatus === "synced"
															? "positive"
															: a.syncStatus === "error"
																? "negative"
																: "default"
													}
												>
													{SYNC_STATUS_LABELS[a.syncStatus]}
												</Badge>
											</TableCell>
											<TableCell className="hidden font-mono text-xs text-text-muted lg:table-cell">
												{a.lastTransactionDate
													? f.date(a.lastTransactionDate)
													: "—"}
											</TableCell>
											<TableCell className="text-right text-text-secondary">
												<Link
													to="/transactions"
													search={{ accountId: a.id }}
													onClick={(event) => event.stopPropagation()}
													className="text-brand hover:underline"
													aria-label={`Alle ${a.transactionCount} Transaktionen von ${a.name}`}
												>
													{a.transactionCount} Buchungen
												</Link>
											</TableCell>
											<TableCell className="text-right">
												<Money
													amountMinor={a.currentBalanceMinor}
													currency={a.currency}
													tone={
														a.currentBalanceMinor < 0 ? "negative" : "default"
													}
												/>
												<span className="block font-mono text-[10px] text-text-muted">
													Stand{" "}
													{a.balanceAsOf ? f.date(a.balanceAsOf, "short") : "—"}
												</span>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
						{/* Sums sit below the list, not in a table footer: a footer
						    cell spanning hidden columns forced phantom columns. */}
						<dl className="border-t border-border bg-surface-sunken/60 px-4 py-2 text-sm">
							{Array.from(byCurrency.entries()).map(([cur, total]) => (
								<div
									key={cur}
									className="flex items-baseline justify-between gap-3 py-1"
								>
									<dt className="text-text-secondary">Summe {cur}</dt>
									<dd>
										<Money amountMinor={total} currency={cur} />
									</dd>
								</div>
							))}
						</dl>
					</>
				)}
			</Card>
			{depots.length > 0 ? (
				<Card>
					<CardHeader
						title="Depots"
						subtitle="Getrennt geführt, nicht doppelt gezählt."
					/>
					<ul className="border-t border-border">
						{depots.map((depot) => (
							<li
								key={depot.id}
								className="border-b border-border last:border-b-0"
							>
								<Link
									to="/depots/$id"
									params={{ id: depot.id }}
									search={{ page: 1 }}
									className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 outline-none hover:bg-surface-sunken/50 focus-visible:bg-surface-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
								>
									<span className="min-w-0 flex-1 basis-48">
										<span className="flex flex-wrap items-center gap-2">
											<span className="break-words text-sm font-medium text-text">
												{depot.label}
											</span>
											<Badge
												variant={
													depot.status === "active" ? "positive" : "warning"
												}
											>
												{depot.status === "active"
													? "Aktiv"
													: depot.status === "disconnected"
														? "Getrennt"
														: "Prüfen"}
											</Badge>
										</span>
										<span className="mt-0.5 block break-words text-xs text-text-muted">
											{depot.method === "cli" ? "Automatisch" : "Geschätzt"} ·{" "}
											{depot.lastSyncAt
												? `Abgleich ${f.dateTime(depot.lastSyncAt)}`
												: "ohne Abgleich"}{" "}
											· {depot.positionCount} Positionen ·{" "}
											{depot.transactionCount} Buchungen
										</span>
									</span>
									<span className="grid shrink-0 grid-cols-2 gap-x-5 text-right">
										<span>
											<span className="label-caps block">Depotwert</span>
											{depot.portfolioValueMinor === null ? (
												<span className="text-sm text-text-muted">
													ohne Wert
												</span>
											) : (
												<Money
													amountMinor={depot.portfolioValueMinor}
													currency={depot.currency}
													className="text-sm"
												/>
											)}
											{depot.cryptoValueMinor ? (
												<span className="block text-[11px] text-text-muted">
													davon Krypto{" "}
													{f.money(depot.cryptoValueMinor, depot.currency)}
												</span>
											) : null}
										</span>
										<span>
											<span className="label-caps block">Guthaben</span>
											{depot.cashBalanceMinor === null ? (
												<span className="text-sm text-text-muted">
													nicht verfügbar
												</span>
											) : (
												<Money
													amountMinor={depot.cashBalanceMinor}
													currency={depot.currency}
													className="text-sm"
												/>
											)}
										</span>
									</span>
								</Link>
							</li>
						))}
					</ul>
				</Card>
			) : null}
			{inactive.length > 0 ? (
				<Card>
					<p className="label-caps px-4 pt-4">Inaktiv</p>
					<ul className="divide-y divide-border">
						{inactive.map((a) => (
							<li key={a.id}>
								<Link
									to="/accounts/$id"
									params={{ id: a.id }}
									className="flex min-h-11 items-center justify-between gap-3 px-4 py-2 text-[13px] text-text-muted hover:bg-surface-sunken/50"
								>
									<span className="min-w-0 break-words">{a.name}</span>
									<Money
										amountMinor={a.currentBalanceMinor}
										currency={a.currency}
										tone="muted"
									/>
								</Link>
							</li>
						))}
					</ul>
				</Card>
			) : null}
			<AccountDialog
				open={open}
				onOpenChange={setOpen}
				defaultCurrency={settings.baseCurrency}
			/>
		</div>
	);
}

export function AccountDialog({
	open,
	onOpenChange,
	defaultCurrency,
}: {
	open: boolean;
	onOpenChange: (o: boolean) => void;
	defaultCurrency: string;
}) {
	const invalidate = useInvalidateAll();
	const [type, setType] = useState("current");
	const create = useMutation(
		orpc.accounts.create.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Konto hinzugefügt");
				onOpenChange(false);
			},
			onError: reportError,
		}),
	);
	function submit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = new FormData(e.currentTarget);
		const opening = amount(form, "openingBalance");
		create.mutate({
			name: str(form, "name"),
			institution: optStr(form, "institution"),
			type: str(form, "type") as (typeof ACCOUNT_TYPES)[number],
			currency: str(form, "currency"),
			iban: optStr(form, "iban"),
			openingBalanceMinor: opening ?? 0,
			openingBalanceDate: str(form, "openingBalanceDate") || todayIso(),
			creditLimitMinor: amount(form, "creditLimit"),
			includeInNetWorth: form.get("includeInNetWorth") === "on",
			notes: optStr(form, "notes"),
		});
	}
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title="Konto hinzufügen"
				description="Importierte Transaktionen verändern den Saldo. Einen abgelesenen Kontostand kannst du jederzeit erfassen."
			>
				<form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
					<Field label="Name" htmlFor="acc-name" className="sm:col-span-2">
						<Input
							id="acc-name"
							name="name"
							required
							maxLength={200}
							autoFocus
						/>
					</Field>
					<Field label="Institut" htmlFor="acc-institution">
						<Input id="acc-institution" name="institution" maxLength={200} />
					</Field>
					<Field label="Typ" htmlFor="acc-type">
						<NativeSelect
							id="acc-type"
							name="type"
							defaultValue="current"
							onChange={(event) => setType(event.currentTarget.value)}
						>
							{ACCOUNT_TYPES.map((t) => (
								<option key={t} value={t}>
									{ACCOUNT_TYPE_LABELS[t]}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field label="Währung" htmlFor="acc-currency">
						<NativeSelect
							id="acc-currency"
							name="currency"
							defaultValue={defaultCurrency}
						>
							{CURRENCIES.map((c) => (
								<option key={c}>{c}</option>
							))}
						</NativeSelect>
					</Field>
					<Field
						label="IBAN"
						htmlFor="acc-iban"
						hint="Dient zur Erkennung von Umbuchungen zwischen eigenen Konten."
					>
						<Input
							id="acc-iban"
							name="iban"
							maxLength={34}
							className="font-mono"
						/>
					</Field>
					<Field
						label="Aktueller Saldo"
						htmlFor="acc-opening"
						hint="Bei offenen Kreditkartenschulden negativ eingeben."
					>
						<Input
							id="acc-opening"
							name="openingBalance"
							inputMode="decimal"
							placeholder="0,00"
							className="amount"
						/>
					</Field>
					<Field label="Stand vom" htmlFor="acc-opening-date">
						<Input
							id="acc-opening-date"
							name="openingBalanceDate"
							type="date"
							defaultValue={todayIso()}
						/>
					</Field>
					<Field
						label="Kreditrahmen"
						htmlFor="acc-limit"
						// Shown as a blank field on every account type, with a note
						// saying it did not apply — an input that exists to be ignored.
						className={type === "credit_card" ? undefined : "hidden"}
					>
						<Input
							id="acc-limit"
							name="creditLimit"
							inputMode="decimal"
							className="amount"
						/>
					</Field>
					<label className="flex items-center gap-2 text-xs text-text-secondary sm:col-span-2">
						<input
							type="checkbox"
							name="includeInNetWorth"
							defaultChecked
							className="accent-brand"
						/>{" "}
						Im Nettovermögen berücksichtigen
					</label>
					<Field label="Notizen" htmlFor="acc-notes" className="sm:col-span-2">
						<Textarea id="acc-notes" name="notes" rows={2} />
					</Field>
					<div className="flex justify-end gap-2 sm:col-span-2">
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
						>
							Abbrechen
						</Button>
						<Button type="submit" disabled={create.isPending}>
							Konto hinzufügen
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
