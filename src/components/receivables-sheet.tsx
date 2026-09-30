import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { ChevronDown, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { BalanceActionsDialog } from "@/components/balance-actions";
import { LineChart } from "@/components/charts/line-chart";
import {
	AmountInput,
	SectionHeader,
	SettledGroup,
	SheetBar,
	SheetRow,
} from "@/components/sheet";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { todayIso } from "@/domain/dates";
import { repaidShare, splitSettled } from "@/domain/settlement";
import { Money, useFormat } from "@/lib/format";
import {
	amount,
	CURRENCIES,
	num,
	optStr,
	parseAmountInput,
	reportError,
	str,
	toAmountInput,
	useInvalidateAll,
} from "@/lib/forms";
import { orpc } from "@/lib/orpc";

/** What the Forderungen tab needs before it renders. */
export function receivablesQueries() {
	return [
		orpc.receivables.list.queryOptions({ input: { includeInactive: true } }),
		orpc.netWorth.current.queryOptions(),
		orpc.settings.get.queryOptions(),
	] as const;
}

type Row = Awaited<ReturnType<typeof orpc.receivables.list.call>>[number];

/** The name a receivable gets when the owner only said who owes it. */
const DEFAULT_NAME = "Ausgelegter Betrag";

/**
 * The Forderungen sheet, one tab of Forderungen & Schulden. A tap on a row
 * opens its actions (Teilzahlung, beglichen, Betrag ändern, Verlauf); settled
 * ones are folded away under "Erledigt".
 */
export function ReceivablesPanel({ highlight }: { highlight?: string }) {
	const { data: rows } = useSuspenseQuery(
		orpc.receivables.list.queryOptions({ input: { includeInactive: true } }),
	);
	const { data: nw } = useSuspenseQuery(orpc.netWorth.current.queryOptions());
	const { data: settings } = useSuspenseQuery(orpc.settings.get.queryOptions());
	const f = useFormat();
	const invalidate = useInvalidateAll();
	const [editing, setEditing] = useState<Row | null>(null);
	const [adding, setAdding] = useState(false);
	const [acting, setActing] = useState<string | null>(
		highlight && rows.some((row) => row.id === highlight) ? highlight : null,
	);
	const [selected, setSelected] = useState<string | null>(
		highlight ?? rows.find((row) => row.isActive)?.id ?? rows[0]?.id ?? null,
	);
	const { data: detail } = useQuery({
		...orpc.receivables.get.queryOptions({ input: { id: selected ?? "" } }),
		enabled: Boolean(selected),
	});
	const update = useMutation(
		orpc.receivables.update.mutationOptions({
			onSuccess: () => invalidate(),
			onError: reportError,
		}),
	);
	const { open, settled } = splitSettled(rows);
	const expectedMonthly = open
		.filter((row) => row.currency === settings.baseCurrency)
		.reduce((sum, row) => sum + (row.monthlyPaymentMinor ?? 0), 0);
	const sections = new Map<string, Row[]>();
	for (const row of open) {
		const name = row.section?.trim() || "Forderungen";
		sections.set(name, [...(sections.get(name) ?? []), row]);
	}
	const actingRow = rows.find((row) => row.id === acting) ?? null;
	const openRow = (row: Row) => {
		setSelected(row.id);
		setActing(row.id);
	};
	const renderRow = (row: Row) => (
		<SheetRow
			key={row.id}
			title={row.debtorName}
			meta={[
				row.name !== DEFAULT_NAME ? row.name : null,
				row.dueDate ? `fällig ${f.date(row.dueDate, "short")}` : null,
				!row.isActive && row.settledAt
					? `beglichen ${f.date(row.settledAt, "short")}`
					: null,
			]
				.filter(Boolean)
				.join(" · ")}
			amount={
				<Money
					amountMinor={row.currentBalanceMinor}
					currency={row.currency}
					tone={row.isActive ? "default" : "muted"}
				/>
			}
			amountDetail={
				row.isActive && row.balanceAsOf
					? `Stand ${f.date(row.balanceAsOf, "short")}`
					: undefined
			}
			progress={
				row.isActive
					? repaidShare(row.originalAmountMinor, row.currentBalanceMinor)
					: null
			}
			selected={selected === row.id}
			muted={!row.isActive}
			onOpen={() => openRow(row)}
			label={`${row.debtorName}, ${row.name}: ${f.money(row.currentBalanceMinor, row.currency)} ${row.isActive ? "offen" : "beglichen"}`}
		/>
	);

	return (
		<div className="space-y-5">
			<SheetBar
				subtitle={
					<span>
						Offen{" "}
						<Money amountMinor={nw.receivablesMinor} className="text-[13px]" />{" "}
						· {open.length} {open.length === 1 ? "Forderung" : "Forderungen"}
						{expectedMonthly > 0
							? ` · ${f.money(expectedMonthly)} erwartet pro Monat`
							: ""}
					</span>
				}
				actions={
					<>
						<Button onClick={() => setAdding(true)}>
							<Plus /> Forderung
						</Button>
						<Button variant="outline" asChild>
							<a href="/api/export/receivables" download>
								CSV
							</a>
						</Button>
					</>
				}
			/>
			<div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
				<div className="space-y-4">
					{open.length === 0 ? (
						<Card>
							<EmptyState
								title={
									settled.length ? "Alles beglichen" : "Noch keine Forderungen"
								}
								description="Erfasse, wer dir Geld schuldet. Rückzahlungen landen mit Datum im Verlauf."
								action={
									<Button onClick={() => setAdding(true)}>
										Forderung hinzufügen
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
								subtotalMinor={list
									.filter((row) => row.currency === settings.baseCurrency)
									.reduce((sum, row) => sum + row.currentBalanceMinor, 0)}
								onRename={(newName) => {
									for (const row of list)
										update.mutate({ id: row.id, section: newName });
								}}
							/>
							<div>{list.map(renderRow)}</div>
						</Card>
					))}
					<SettledGroup count={settled.length}>
						{settled.map(renderRow)}
					</SettledGroup>
				</div>
				{/* The history beside the list where there is room; on a phone it
				    is the Verlauf entry of a row's actions. */}
				<Card className="hidden self-start xl:flex">
					<CardHeader
						title="Verlauf"
						subtitle={
							detail
								? `${detail.debtorName} · ${detail.name}`
								: "Forderung auswählen"
						}
					/>
					<CardBody>
						{detail?.balances.length ? (
							<LineChart
								ariaLabel={`Offener Betrag für ${detail.name}`}
								series={[
									{
										key: "receivable",
										label: "Offener Betrag",
										points: detail.balances.map((balance) => ({
											x: balance.date,
											y: balance.balanceMinor,
										})),
										area: true,
										color: "var(--fortuna-chart-3)",
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
								<dt className="text-text-muted">Schuldner</dt>
								<dd className="text-right">{detail.debtorName}</dd>
								{detail.monthlyPaymentMinor !== null ? (
									<>
										<dt className="text-text-muted">Erwartete Rate</dt>
										<dd className="text-right">
											<Money
												amountMinor={detail.monthlyPaymentMinor}
												currency={detail.currency}
											/>
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
				<ReceivableActions
					row={actingRow}
					onClose={() => setActing(null)}
					onEdit={() => {
						setActing(null);
						setEditing(actingRow);
					}}
				/>
			) : null}
			{adding ? (
				<NewReceivableDialog
					onClose={() => setAdding(false)}
					defaultCurrency={settings.baseCurrency}
					sections={Array.from(
						new Set(
							rows
								.map((row) => row.section?.trim())
								.filter((name): name is string => Boolean(name)),
						),
					)}
				/>
			) : null}
			{editing ? (
				<ReceivableDialog
					row={editing}
					onClose={() => setEditing(null)}
					defaultCurrency={settings.baseCurrency}
				/>
			) : null}
		</div>
	);
}

function ReceivableActions({
	row,
	onClose,
	onEdit,
}: {
	row: Row;
	onClose: () => void;
	onEdit: () => void;
}) {
	const invalidate = useInvalidateAll();
	const f = useFormat();
	const { data: detail } = useQuery(
		orpc.receivables.get.queryOptions({ input: { id: row.id } }),
	);
	const record = useMutation(
		orpc.receivables.recordBalance.mutationOptions({ onError: reportError }),
	);
	const write = async (date: string, balanceMinor: number, message: string) => {
		await record.mutateAsync({ receivableId: row.id, date, balanceMinor });
		await invalidate();
		toast.success(message);
	};
	return (
		<BalanceActionsDialog
			title={row.debtorName}
			subtitle={row.name !== DEFAULT_NAME ? row.name : undefined}
			currency={row.currency}
			balanceMinor={row.currentBalanceMinor}
			balanceAsOf={row.balanceAsOf}
			originalMinor={row.originalAmountMinor}
			copy={{
				balanceLabel: "Offen",
				afterLabel: "Danach offen",
				payment: {
					label: "Teilzahlung erhalten",
					field: "Erhaltener Betrag",
				},
				settle: {
					label: "Vollständig beglichen",
					detail: "Setzt den offenen Betrag auf 0",
					submit: "Als beglichen speichern",
				},
				amount: {
					label: row.isActive ? "Betrag ändern" : "Wieder öffnen",
					field: "Offener Betrag",
				},
			}}
			canRecord
			canSettle={row.isActive}
			history={detail?.balances}
			onRecord={({ date, balanceMinor, kind }) =>
				write(
					date,
					balanceMinor,
					kind === "payment"
						? `Teilzahlung erfasst · noch ${f.money(balanceMinor, row.currency)} offen`
						: "Offenen Betrag aktualisiert",
				)
			}
			onSettle={(date) => write(date, 0, `${row.debtorName}: beglichen`)}
			onEdit={onEdit}
			onClose={onClose}
		/>
	);
}

/**
 * The short way in: who, how much, and when it is due. Everything else is
 * folded under "Weitere Angaben" and can be added later.
 */
function NewReceivableDialog({
	onClose,
	defaultCurrency,
	sections,
}: {
	onClose: () => void;
	defaultCurrency: string;
	sections: string[];
}) {
	const invalidate = useInvalidateAll();
	const [amountText, setAmountText] = useState("");
	const [more, setMore] = useState(false);
	const create = useMutation(
		orpc.receivables.create.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Forderung hinzugefügt");
				onClose();
			},
			onError: reportError,
		}),
	);
	return (
		<Dialog open onOpenChange={(value) => !value && onClose()}>
			<DialogContent title="Forderung hinzufügen">
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						const form = new FormData(event.currentTarget);
						const value = parseAmountInput(amountText);
						if (value === null || value <= 0)
							return toast.error("Betrag eingeben");
						create.mutate({
							name: str(form, "name") || DEFAULT_NAME,
							debtorName: str(form, "debtorName"),
							currency: str(form, "currency") || defaultCurrency,
							originalAmountMinor: value,
							currentBalanceMinor: value,
							balanceDate: todayIso(),
							dueDate: optStr(form, "dueDate"),
							section: optStr(form, "section"),
							notes: optStr(form, "notes"),
						});
					}}
				>
					<Field label="Wer schuldet dir Geld?" htmlFor="nr-debtor">
						<Input
							id="nr-debtor"
							name="debtorName"
							required
							autoFocus
							autoComplete="off"
							enterKeyHint="next"
							placeholder="z. B. Mama"
						/>
					</Field>
					<AmountInput
						id="nr-amount"
						label="Betrag"
						value={amountText}
						onChange={setAmountText}
						currency={defaultCurrency}
						autoFocus={false}
					/>
					<div className="grid gap-4 min-[430px]:grid-cols-2">
						<Field label="Wofür? (optional)" htmlFor="nr-name">
							<Input
								id="nr-name"
								name="name"
								autoComplete="off"
								placeholder="z. B. Konzertkarten"
							/>
						</Field>
						<Field label="Fällig am (optional)" htmlFor="nr-due">
							<Input id="nr-due" name="dueDate" type="date" />
						</Field>
					</div>
					<button
						type="button"
						aria-expanded={more}
						onClick={() => setMore((value) => !value)}
						className="flex min-h-11 items-center gap-1 text-sm text-text-secondary hover:text-text"
					>
						<ChevronDown
							className={more ? "size-4 rotate-180" : "size-4"}
							aria-hidden
						/>
						Weitere Angaben
					</button>
					<div
						className={more ? "grid gap-4 min-[430px]:grid-cols-2" : "hidden"}
					>
						<Field label="Bereich" htmlFor="nr-section">
							<Input
								id="nr-section"
								name="section"
								list="nr-sections"
								placeholder="z. B. Familie"
							/>
							<datalist id="nr-sections">
								{sections.map((name) => (
									<option key={name} value={name} />
								))}
							</datalist>
						</Field>
						<Field label="Währung" htmlFor="nr-currency">
							<NativeSelect
								id="nr-currency"
								name="currency"
								defaultValue={defaultCurrency}
							>
								{CURRENCIES.map((currency) => (
									<option key={currency}>{currency}</option>
								))}
							</NativeSelect>
						</Field>
						<Field
							label="Notizen"
							htmlFor="nr-notes"
							className="min-[430px]:col-span-2"
						>
							<Textarea id="nr-notes" name="notes" rows={2} />
						</Field>
					</div>
					<Button
						type="submit"
						size="lg"
						className="w-full"
						disabled={create.isPending}
					>
						Hinzufügen
					</Button>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function ReceivableDialog({
	row,
	onClose,
	defaultCurrency,
}: {
	row: Row | null;
	onClose: () => void;
	defaultCurrency: string;
}) {
	const invalidate = useInvalidateAll();
	const done = async (message: string) => {
		await invalidate();
		toast.success(message);
		onClose();
	};
	const create = useMutation(
		orpc.receivables.create.mutationOptions({
			onSuccess: () => done("Forderung hinzugefügt"),
			onError: reportError,
		}),
	);
	const update = useMutation(
		orpc.receivables.update.mutationOptions({
			onSuccess: () => done("Forderung gespeichert"),
			onError: reportError,
		}),
	);
	const remove = useMutation(
		orpc.receivables.delete.mutationOptions({
			onSuccess: () => done("Forderung gelöscht"),
			onError: reportError,
		}),
	);
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				title={row ? row.name : "Forderung hinzufügen"}
				description="Erfasse den offenen Betrag. Jede spätere Änderung wird mit Datum im Verlauf gespeichert."
			>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						const form = new FormData(event.currentTarget);
						const rate = num(form, "rate");
						const base = {
							name: str(form, "name"),
							debtorName: str(form, "debtorName"),
							currency: str(form, "currency"),
							originalAmountMinor: amount(form, "originalAmount"),
							interestRateBps: rate === null ? null : Math.round(rate * 100),
							monthlyPaymentMinor: amount(form, "monthlyPayment"),
							startDate: optStr(form, "startDate"),
							dueDate: optStr(form, "dueDate"),
							section: optStr(form, "section"),
							notes: optStr(form, "notes"),
						};
						if (row) {
							update.mutate({
								id: row.id,
								...base,
								isActive: form.get("isActive") === "on",
								settledAt:
									form.get("isActive") === "on"
										? null
										: (row.settledAt ?? todayIso()),
							});
						} else {
							const balance = amount(form, "currentBalance");
							if (balance === null)
								return toast.error("Offenen Betrag eingeben");
							create.mutate({
								...base,
								currentBalanceMinor: balance,
								balanceDate: str(form, "balanceDate") || todayIso(),
							});
						}
					}}
					className="grid gap-3 sm:grid-cols-2"
				>
					<Field label="Bezeichnung" htmlFor="r-name" className="sm:col-span-2">
						<Input
							id="r-name"
							name="name"
							placeholder="z. B. Gemeinsamer Urlaub"
							defaultValue={row?.name ?? ""}
							required
							autoFocus
						/>
					</Field>
					<Field label="Wer schuldet dir Geld?" htmlFor="r-debtor">
						<Input
							id="r-debtor"
							name="debtorName"
							defaultValue={row?.debtorName ?? ""}
							required
						/>
					</Field>
					<Field label="Bereich" htmlFor="r-section">
						<Input
							id="r-section"
							name="section"
							placeholder="z. B. Familie"
							defaultValue={row?.section ?? ""}
						/>
					</Field>
					<Field label="Währung" htmlFor="r-currency">
						<NativeSelect
							id="r-currency"
							name="currency"
							defaultValue={row?.currency ?? defaultCurrency}
						>
							{CURRENCIES.map((currency) => (
								<option key={currency}>{currency}</option>
							))}
						</NativeSelect>
					</Field>
					{!row ? (
						<Field label="Aktuell offen" htmlFor="r-balance">
							<Input
								id="r-balance"
								name="currentBalance"
								inputMode="decimal"
								className="amount"
								required
							/>
						</Field>
					) : null}
					{!row ? (
						<Field label="Stand vom" htmlFor="r-balance-date">
							<Input
								id="r-balance-date"
								name="balanceDate"
								type="date"
								defaultValue={todayIso()}
							/>
						</Field>
					) : null}
					<Field label="Ursprünglicher Betrag" htmlFor="r-original">
						<Input
							id="r-original"
							name="originalAmount"
							inputMode="decimal"
							className="amount"
							defaultValue={toAmountInput(row?.originalAmountMinor)}
						/>
					</Field>
					<Field label="Erwartete Monatsrate" htmlFor="r-monthly">
						<Input
							id="r-monthly"
							name="monthlyPayment"
							inputMode="decimal"
							className="amount"
							defaultValue={toAmountInput(row?.monthlyPaymentMinor)}
						/>
					</Field>
					<Field label="Zinssatz %" htmlFor="r-rate">
						<Input
							id="r-rate"
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
					<Field label="Beginn" htmlFor="r-start">
						<Input
							id="r-start"
							name="startDate"
							type="date"
							defaultValue={row?.startDate ?? ""}
						/>
					</Field>
					<Field label="Fällig am" htmlFor="r-due">
						<Input
							id="r-due"
							name="dueDate"
							type="date"
							defaultValue={row?.dueDate ?? ""}
						/>
					</Field>
					{row ? (
						<label className="flex items-center gap-2 text-xs text-text-secondary sm:col-span-2">
							<input
								type="checkbox"
								name="isActive"
								defaultChecked={row.isActive}
								className="accent-brand"
							/>
							Noch offen
						</label>
					) : null}
					<Field label="Notizen" htmlFor="r-notes" className="sm:col-span-2">
						<Textarea
							id="r-notes"
							name="notes"
							rows={3}
							defaultValue={row?.notes ?? ""}
						/>
					</Field>
					<div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
						{row ? (
							<Button
								type="button"
								variant="destructive"
								size="sm"
								onClick={() => {
									if (confirm("Diese Forderung löschen?"))
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
