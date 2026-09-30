import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CreditCard, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { BalanceActionsDialog } from "@/components/balance-actions";
import { LineChart } from "@/components/charts/line-chart";
import {
	SectionHeader,
	SettledGroup,
	SheetBar,
	SheetRow,
} from "@/components/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { todayIso } from "@/domain/dates";
import { repaidShare, splitRate, splitSettled } from "@/domain/settlement";
import { Money, useFormat } from "@/lib/format";
import {
	amount,
	CURRENCIES,
	num,
	optStr,
	reportError,
	str,
	toAmountInput,
	useInvalidateAll,
} from "@/lib/forms";
import { LIABILITY_TYPE_LABELS } from "@/lib/labels";
import { orpc } from "@/lib/orpc";
import { LIABILITY_TYPES } from "@/lib/schemas";
import { cn } from "@/lib/utils";

const SHEETS: {
	key: string;
	label: string;
	types: (typeof LIABILITY_TYPES)[number][];
}[] = [
	{ key: "all", label: "Alle", types: [...LIABILITY_TYPES] },
	{ key: "cards", label: "Kreditkarten", types: ["credit_card"] },
	{
		key: "loans",
		label: "Darlehen",
		types: ["personal_loan", "mortgage", "vehicle_finance"],
	},
	{ key: "other", label: "Sonstige", types: ["other"] },
];

export const LIABILITY_SHEET_KEYS = SHEETS.map((sheet) => sheet.key);

/** What the Schulden tab needs before it renders. */
export function liabilitiesQueries() {
	return [
		orpc.liabilities.list.queryOptions({ input: { includeInactive: true } }),
		orpc.assets.list.queryOptions({ input: {} }),
		orpc.accounts.list.queryOptions({ input: {} }),
		orpc.netWorth.current.queryOptions(),
	] as const;
}

type Row = Awaited<ReturnType<typeof orpc.liabilities.list.call>>[number];

function owed(l: Row): number {
	return l.owedMinor;
}

/**
 * The Verbindlichkeiten sheet, one tab of Forderungen & Schulden. A tap on a
 * row opens its actions (Rate gezahlt, Restschuld aktualisieren, Abgelöst,
 * Verlauf); paid-off ones are folded away under "Abgelöst".
 */
export function LiabilitiesPanel({
	highlight,
	sheet = "all",
	onSheet,
}: {
	highlight?: string;
	sheet?: string;
	onSheet: (sheet: string | undefined) => void;
}) {
	const { data: rows } = useSuspenseQuery(
		orpc.liabilities.list.queryOptions({ input: { includeInactive: true } }),
	);
	const { data: assets } = useSuspenseQuery(
		orpc.assets.list.queryOptions({ input: {} }),
	);
	const { data: accounts } = useSuspenseQuery(
		orpc.accounts.list.queryOptions({ input: {} }),
	);
	const { data: nw } = useSuspenseQuery(orpc.netWorth.current.queryOptions());
	const { data: settings } = useSuspenseQuery(orpc.settings.get.queryOptions());
	const f = useFormat();
	const invalidate = useInvalidateAll();
	const [editing, setEditing] = useState<Row | null | "new">(null);
	const [acting, setActing] = useState<string | null>(
		highlight && rows.some((row) => row.id === highlight) ? highlight : null,
	);
	const [selected, setSelected] = useState<string | null>(
		highlight ?? rows.find((row) => row.isActive)?.id ?? rows[0]?.id ?? null,
	);
	const { data: detail } = useQuery({
		...orpc.liabilities.get.queryOptions({ input: { id: selected ?? "" } }),
		enabled: Boolean(selected),
	});
	const update = useMutation(
		orpc.liabilities.update.mutationOptions({
			onSuccess: () => invalidate(),
			onError: reportError,
		}),
	);

	const current = SHEETS.find((s) => s.key === sheet) ?? SHEETS[0];
	const active = rows.filter((r) => r.isActive);
	const sheetTotals = SHEETS.map((s) => ({
		...s,
		totalMinor: active
			.filter(
				(l) => s.types.includes(l.type) && l.currency === settings.baseCurrency,
			)
			.reduce((sum, l) => sum + owed(l), 0),
	}));
	const { open, settled } = splitSettled(
		rows.filter((l) => current.types.includes(l.type)),
	);
	const sections = new Map<string, Row[]>();
	for (const l of open) {
		const name = l.section?.trim() || LIABILITY_TYPE_LABELS[l.type];
		sections.set(name, [...(sections.get(name) ?? []), l]);
	}
	const monthly = active
		.filter((r) => r.currency === settings.baseCurrency)
		.reduce((s, r) => s + (r.monthlyPaymentMinor ?? 0), 0);
	const actingRow = rows.find((row) => row.id === acting) ?? null;
	const renderRow = (l: Row) => {
		const balance = owed(l);
		return (
			<SheetRow
				key={l.id}
				title={l.name}
				meta={[
					l.lender,
					l.interestRateBps !== null
						? `${f.number(l.interestRateBps / 100, 2)} %`
						: null,
					l.monthlyPaymentMinor !== null
						? `${f.money(l.monthlyPaymentMinor, l.currency)} / Monat`
						: null,
				]
					.filter(Boolean)
					.join(" · ")}
				badges={
					l.linkedAssetName || l.linkedAccountName ? (
						<>
							{l.linkedAssetName ? (
								<Badge>für {l.linkedAssetName}</Badge>
							) : null}
							{l.linkedAccountName ? <Badge>vom Konto</Badge> : null}
						</>
					) : null
				}
				amount={
					<Money
						amountMinor={-balance}
						currency={l.currency}
						tone={l.isActive && balance > 0 ? "negative" : "muted"}
					/>
				}
				amountDetail={
					l.owedAsOf ? `Stand ${f.date(l.owedAsOf, "short")}` : undefined
				}
				progress={
					l.isActive ? repaidShare(l.originalAmountMinor, balance) : null
				}
				selected={selected === l.id}
				muted={!l.isActive}
				onOpen={() => {
					setSelected(l.id);
					setActing(l.id);
				}}
				label={`${l.name}: Restschuld ${f.money(balance, l.currency)}`}
			/>
		);
	};

	return (
		<div className="space-y-5">
			<SheetBar
				subtitle={
					<span>
						Gesamtschulden{" "}
						<Money
							amountMinor={nw.totalLiabilitiesMinor}
							tone={nw.totalLiabilitiesMinor > 0 ? "negative" : "default"}
							className="text-[13px]"
						/>{" "}
						· {f.money(monthly)} monatliche Zahlungen · Schuldenquote{" "}
						{nw.totalAssetsMinor > 0
							? f
									.percent(
										(nw.totalLiabilitiesMinor / nw.totalAssetsMinor) * 100,
									)
									.replace("+", "")
							: "—"}
					</span>
				}
				actions={
					<>
						<Button onClick={() => setEditing("new")}>
							<Plus /> Verbindlichkeit
						</Button>
						<Button variant="outline" asChild>
							<a href="/api/export/liabilities" download>
								CSV
							</a>
						</Button>
					</>
				}
			/>
			<div className="flex flex-wrap gap-x-1 border-b border-border">
				{sheetTotals.map((s) => (
					<button
						key={s.key}
						type="button"
						aria-pressed={current.key === s.key}
						onClick={() => onSheet(s.key === "all" ? undefined : s.key)}
						className={cn(
							"-mb-px min-h-11 border-b-2 px-3 py-2 text-left outline-none focus-visible:outline-2 focus-visible:outline-focus",
							current.key === s.key
								? "border-brand text-text"
								: "border-transparent text-text-secondary hover:text-text",
						)}
					>
						<span className="block text-[13px] font-medium">{s.label}</span>
						<span className="amount block text-[11px] text-text-muted">
							{f.money(s.totalMinor, undefined, { compact: true })}
						</span>
					</button>
				))}
			</div>
			<div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
				<div className="space-y-4">
					{open.length === 0 ? (
						<Card>
							<EmptyState
								title="Dieser Bereich ist leer"
								description="Füge ein Immobiliendarlehen, eine Fahrzeugfinanzierung oder einen Privatkredit hinzu, um ihn deinem Vermögen gegenüberzustellen."
								action={
									<Button onClick={() => setEditing("new")}>
										Verbindlichkeit hinzufügen
									</Button>
								}
							/>
						</Card>
					) : null}
					{Array.from(sections.entries()).map(([name, list]) => (
						<Card key={name} className="overflow-hidden">
							<SectionHeader
								title={name}
								count={list.length}
								subtotalMinor={
									-list
										.filter((l) => l.currency === settings.baseCurrency)
										.reduce((s, l) => s + owed(l), 0)
								}
								onRename={(newName) => {
									for (const l of list)
										update.mutate({ id: l.id, section: newName });
								}}
							/>
							<div>{list.map(renderRow)}</div>
						</Card>
					))}
					<SettledGroup count={settled.length} label="Abgelöst">
						{settled.map(renderRow)}
					</SettledGroup>
				</div>
				{/* The history beside the list where there is room; on a phone it
				    is the Verlauf entry of a row's actions. */}
				<Card className="hidden self-start xl:flex">
					<CardHeader
						title="Schuldenverlauf"
						subtitle={detail?.name ?? "Verbindlichkeit auswählen"}
					/>
					<CardBody>
						{detail && detail.balances.length > 0 ? (
							<LineChart
								ariaLabel={`Schuldenverlauf von ${detail.name}`}
								series={[
									{
										key: "b",
										label: "Restschuld",
										points: detail.balances.map((b) => ({
											x: b.date,
											y: b.balanceMinor,
										})),
										area: true,
										color: "var(--fortuna-negative)",
									},
								]}
								currency={detail.currency}
								height={200}
							/>
						) : (
							<p className="text-xs text-text-muted">Kein Verlauf vorhanden.</p>
						)}
						{detail ? (
							<dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
								{detail.originalAmountMinor !== null ? (
									<>
										<dt className="text-text-muted">Ursprünglicher Betrag</dt>
										<dd className="text-right">
											<Money
												amountMinor={detail.originalAmountMinor}
												currency={detail.currency}
												weight="medium"
											/>
										</dd>
									</>
								) : null}
								{detail.startDate ? (
									<>
										<dt className="text-text-muted">Start</dt>
										<dd className="text-right font-mono">
											{f.date(detail.startDate)}
										</dd>
									</>
								) : null}
								{detail.endDate ? (
									<>
										<dt className="text-text-muted">Ende</dt>
										<dd className="text-right font-mono">
											{f.date(detail.endDate)}
										</dd>
									</>
								) : null}
								{detail.notes ? (
									<>
										<dt className="text-text-muted">Notizen</dt>
										<dd className="col-span-2 whitespace-pre-wrap text-text-secondary">
											{detail.notes}
										</dd>
									</>
								) : null}
							</dl>
						) : null}
					</CardBody>
				</Card>
			</div>
			{actingRow ? (
				<LiabilityActions
					row={actingRow}
					onClose={() => setActing(null)}
					onEdit={() => {
						setActing(null);
						setEditing(actingRow);
					}}
				/>
			) : null}
			{editing ? (
				<LiabilityDialog
					row={editing === "new" ? null : editing}
					onClose={() => setEditing(null)}
					assets={assets}
					accounts={accounts.filter((a) => a.type === "credit_card")}
					defaultCurrency={settings.baseCurrency}
				/>
			) : null}
		</div>
	);
}

function LiabilityActions({
	row,
	onClose,
	onEdit,
}: {
	row: Row;
	onClose: () => void;
	onEdit: () => void;
}) {
	const invalidate = useInvalidateAll();
	const navigate = useNavigate();
	const f = useFormat();
	const { data: detail } = useQuery(
		orpc.liabilities.get.queryOptions({ input: { id: row.id } }),
	);
	const record = useMutation(
		orpc.liabilities.recordBalance.mutationOptions({ onError: reportError }),
	);
	const update = useMutation(
		orpc.liabilities.update.mutationOptions({ onError: reportError }),
	);
	const balance = owed(row);
	// A linked card takes its debt from the account; recording one here would
	// write a figure nothing reads.
	const fromAccount = row.linkedAccountId !== null;
	const split =
		row.monthlyPaymentMinor !== null
			? splitRate(balance, row.monthlyPaymentMinor, row.interestRateBps)
			: null;
	return (
		<BalanceActionsDialog
			title={row.name}
			subtitle={[LIABILITY_TYPE_LABELS[row.type], row.lender]
				.filter(Boolean)
				.join(" · ")}
			currency={row.currency}
			balanceMinor={balance}
			balanceAsOf={row.owedAsOf}
			originalMinor={row.originalAmountMinor}
			tone="negative"
			copy={{
				balanceLabel: "Restschuld",
				afterLabel: "Danach Restschuld",
				payment: {
					label: "Rate gezahlt",
					detail:
						split && row.monthlyPaymentMinor !== null
							? `Rate ${f.money(row.monthlyPaymentMinor, row.currency)}${split.interestMinor > 0 ? ` · davon Tilgung ${f.money(split.principalMinor, row.currency)}` : ""}`
							: undefined,
					field: "Getilgter Betrag",
					hint:
						split && split.interestMinor > 0
							? `Rate abzüglich geschätzter Zinsen von ${f.money(split.interestMinor, row.currency)}.`
							: undefined,
				},
				settle: {
					label: "Abgelöst",
					detail: "Restschuld 0, nicht mehr aktiv",
					submit: "Als abgelöst speichern",
				},
				amount: {
					label: "Restschuld aktualisieren",
					field: "Restschuld laut Bank",
				},
			}}
			canRecord={row.isActive && !fromAccount}
			canSettle={row.isActive && !fromAccount}
			readOnlyNote={
				fromAccount
					? `Die Restschuld kommt vom Konto ${row.linkedAccountName ?? ""}.`
					: undefined
			}
			extraActions={
				fromAccount && row.linkedAccountId
					? [
							{
								icon: CreditCard,
								label: "Konto öffnen",
								onClick: () =>
									navigate({
										to: "/accounts/$id",
										params: { id: row.linkedAccountId as string },
									}),
							},
						]
					: undefined
			}
			defaultPaymentMinor={split?.principalMinor ?? null}
			history={detail?.balances}
			onRecord={async ({ date, balanceMinor, kind }) => {
				await record.mutateAsync({ liabilityId: row.id, date, balanceMinor });
				await invalidate();
				toast.success(
					kind === "payment"
						? `Rate erfasst · Restschuld ${f.money(balanceMinor, row.currency)}`
						: "Restschuld aktualisiert",
				);
			}}
			onSettle={async (date) => {
				// The zero balance first, so the history ends at 0 on that day;
				// then the liability leaves the list and net worth from its end.
				await record.mutateAsync({
					liabilityId: row.id,
					date,
					balanceMinor: 0,
				});
				await update.mutateAsync({
					id: row.id,
					isActive: false,
					endDate: date,
				});
				await invalidate();
				toast.success(`${row.name}: abgelöst`);
			}}
			onEdit={onEdit}
			onClose={onClose}
		/>
	);
}

function LiabilityDialog({
	row,
	onClose,
	assets,
	accounts,
	defaultCurrency,
}: {
	row: Row | null;
	onClose: () => void;
	assets: { id: string; name: string }[];
	accounts: { id: string; name: string }[];
	defaultCurrency: string;
}) {
	const invalidate = useInvalidateAll();
	const done = async (m: string) => {
		await invalidate();
		toast.success(m);
		onClose();
	};
	const create = useMutation(
		orpc.liabilities.create.mutationOptions({
			onSuccess: () => done("Verbindlichkeit hinzugefügt"),
			onError: reportError,
		}),
	);
	const update = useMutation(
		orpc.liabilities.update.mutationOptions({
			onSuccess: () => done("Gespeichert"),
			onError: reportError,
		}),
	);
	const remove = useMutation(
		orpc.liabilities.delete.mutationOptions({
			onSuccess: () => done("Gelöscht"),
			onError: reportError,
		}),
	);
	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent
				title={row ? row.name : "Verbindlichkeit hinzufügen"}
				description="Verknüpfe ein Kreditkartenkonto, um hier nur die Konditionen zu führen. Die Restschuld kommt dann vom Konto und wird nicht doppelt gezählt."
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						const form = new FormData(e.currentTarget);
						const rate = num(form, "rate");
						const base = {
							name: str(form, "name"),
							type: str(form, "type") as (typeof LIABILITY_TYPES)[number],
							lender: optStr(form, "lender"),
							currency: str(form, "currency"),
							originalAmountMinor: amount(form, "originalAmount"),
							interestRateBps: rate === null ? null : Math.round(rate * 100),
							monthlyPaymentMinor: amount(form, "monthlyPayment"),
							startDate: optStr(form, "startDate"),
							endDate: optStr(form, "endDate"),
							linkedAssetId: optStr(form, "linkedAssetId"),
							linkedAccountId: optStr(form, "linkedAccountId"),
							section: optStr(form, "section"),
							notes: optStr(form, "notes"),
						};
						if (row)
							update.mutate({
								id: row.id,
								...base,
								isActive: form.get("isActive") === "on",
							});
						else {
							const balance = amount(form, "currentBalance");
							if (balance === null)
								return toast.error("Aktuelle Restschuld eingeben");
							create.mutate({
								...base,
								currentBalanceMinor: balance,
								balanceDate: str(form, "balanceDate") || todayIso(),
							});
						}
					}}
					className="grid gap-3 sm:grid-cols-2"
				>
					<Field label="Name" htmlFor="l-name" className="sm:col-span-2">
						<Input
							id="l-name"
							name="name"
							defaultValue={row?.name ?? ""}
							required
							autoFocus
						/>
					</Field>
					<Field label="Typ" htmlFor="l-type">
						<NativeSelect
							id="l-type"
							name="type"
							defaultValue={row?.type ?? "personal_loan"}
						>
							{LIABILITY_TYPES.map((t) => (
								<option key={t} value={t}>
									{LIABILITY_TYPE_LABELS[t]}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field
						label="Bereich"
						htmlFor="l-section"
						hint="Gruppierung in der Übersicht; standardmäßig der Typ."
					>
						<Input
							id="l-section"
							name="section"
							defaultValue={row?.section ?? ""}
						/>
					</Field>
					<Field label="Kreditgeber" htmlFor="l-lender">
						<Input
							id="l-lender"
							name="lender"
							defaultValue={row?.lender ?? ""}
						/>
					</Field>
					<Field label="Währung" htmlFor="l-cur">
						<NativeSelect
							id="l-cur"
							name="currency"
							defaultValue={row?.currency ?? defaultCurrency}
						>
							{CURRENCIES.map((c) => (
								<option key={c}>{c}</option>
							))}
						</NativeSelect>
					</Field>
					{!row ? (
						<Field label="Aktuelle Restschuld" htmlFor="l-bal">
							<Input
								id="l-bal"
								name="currentBalance"
								inputMode="decimal"
								required
								className="amount"
							/>
						</Field>
					) : null}
					{!row ? (
						<Field label="Stand vom" htmlFor="l-baldate">
							<Input
								id="l-baldate"
								name="balanceDate"
								type="date"
								defaultValue={todayIso()}
							/>
						</Field>
					) : null}
					<Field label="Ursprünglicher Betrag" htmlFor="l-orig">
						<Input
							id="l-orig"
							name="originalAmount"
							inputMode="decimal"
							defaultValue={toAmountInput(row?.originalAmountMinor)}
							className="amount"
						/>
					</Field>
					<Field label="Zinssatz %" htmlFor="l-rate">
						<Input
							id="l-rate"
							name="rate"
							type="number"
							step="0.01"
							min={0}
							defaultValue={
								row?.interestRateBps !== null &&
								row?.interestRateBps !== undefined
									? (row.interestRateBps / 100).toFixed(2)
									: ""
							}
						/>
					</Field>
					<Field label="Monatliche Rate" htmlFor="l-monthly">
						<Input
							id="l-monthly"
							name="monthlyPayment"
							inputMode="decimal"
							defaultValue={toAmountInput(row?.monthlyPaymentMinor)}
							className="amount"
						/>
					</Field>
					<Field label="Start" htmlFor="l-start">
						<Input
							id="l-start"
							name="startDate"
							type="date"
							defaultValue={row?.startDate ?? ""}
						/>
					</Field>
					<Field label="Ende" htmlFor="l-end">
						<Input
							id="l-end"
							name="endDate"
							type="date"
							defaultValue={row?.endDate ?? ""}
						/>
					</Field>
					<Field label="Verknüpfter Sachwert" htmlFor="l-asset">
						<NativeSelect
							id="l-asset"
							name="linkedAssetId"
							defaultValue={row?.linkedAssetId ?? ""}
						>
							<option value="">Keiner</option>
							{assets.map((a) => (
								<option key={a.id} value={a.id}>
									{a.name}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field label="Verknüpftes Kreditkartenkonto" htmlFor="l-acc">
						<NativeSelect
							id="l-acc"
							name="linkedAccountId"
							defaultValue={row?.linkedAccountId ?? ""}
						>
							<option value="">Keines</option>
							{accounts.map((a) => (
								<option key={a.id} value={a.id}>
									{a.name}
								</option>
							))}
						</NativeSelect>
					</Field>
					{row ? (
						<label className="flex items-center gap-2 text-xs text-text-secondary sm:col-span-2">
							<input
								type="checkbox"
								name="isActive"
								defaultChecked={row.isActive}
								className="accent-brand"
							/>{" "}
							Aktiv (noch offen)
						</label>
					) : null}
					<Field label="Notizen" htmlFor="l-notes" className="sm:col-span-2">
						<Textarea
							id="l-notes"
							name="notes"
							defaultValue={row?.notes ?? ""}
							rows={2}
						/>
					</Field>
					<div className="flex items-center justify-between sm:col-span-2">
						{row ? (
							<Button
								type="button"
								variant="destructive"
								size="sm"
								onClick={() => {
									if (
										confirm("Diese Verbindlichkeit mit ihrem Verlauf löschen?")
									)
										remove.mutate({ id: row.id });
								}}
							>
								Löschen
							</Button>
						) : (
							<span />
						)}
						<div className="flex gap-2">
							<Button type="button" variant="ghost" onClick={onClose}>
								Abbrechen
							</Button>
							<Button
								type="submit"
								disabled={create.isPending || update.isPending}
							>
								Speichern
							</Button>
						</div>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
