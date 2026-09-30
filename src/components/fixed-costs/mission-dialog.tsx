import { useMutation } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { todayIso } from "@/domain/dates";
import { optimizationSavings } from "@/domain/optimization";
import { Money, useFormat } from "@/lib/format";
import {
	CURRENCIES,
	optStr,
	parseAmountInput,
	reportError,
	str,
	toAmountInput,
	useInvalidateAll,
} from "@/lib/forms";
import { orpc } from "@/lib/orpc";
import { OPTIMIZATION_CATEGORIES, OPTIMIZATION_STATUSES } from "@/lib/schemas";

export const MISSION_CATEGORY_LABELS: Record<string, string> = {
	banking: "Banken & Karten",
	subscription: "Abos",
	insurance: "Versicherungen",
	utilities: "Energie & Verträge",
	shopping: "Einkäufe",
	mobility: "Mobilität",
	other: "Sonstiges",
};

export const MISSION_STATUS_LABELS: Record<string, string> = {
	idea: "Idee",
	planned: "Geplant",
	completed: "Umgesetzt",
	dismissed: "Verworfen",
};

export type MissionRow = Awaited<
	ReturnType<typeof orpc.optimizations.list.call>
>[number];

/** What a new Sparmission starts from: the payment or contract it replaces. */
export type MissionPreset = {
	title: string;
	currentMonthlyMinor: number;
	currency: string;
	category: (typeof OPTIMIZATION_CATEGORIES)[number];
	recurringPaymentId: string | null;
	contractId: string | null;
};

/**
 * Create or edit one Sparmission. `completing` opens it to record the switch:
 * status "Umgesetzt" and the date the old cost stops.
 */
export function MissionDialog({
	row,
	candidate,
	completing = false,
	accounts,
	contracts,
	defaultCurrency,
	onClose,
}: {
	row: MissionRow | null;
	candidate: MissionPreset | null;
	completing?: boolean;
	accounts: { id: string; name: string }[];
	contracts: { id: string; name: string; costsUntil: string | null }[];
	defaultCurrency: string;
	onClose: () => void;
}) {
	const invalidate = useInvalidateAll();
	const f = useFormat();
	const [current, setCurrent] = useState(
		toAmountInput(row?.currentMonthlyMinor ?? candidate?.currentMonthlyMinor),
	);
	// Empty, not "0,00". A new mission opened with the alternative pre-filled at
	// zero, so before typing anything the owner was shown the full current cost
	// as a saving: "5 JAHRE +76.800 €" for not paying their rent.
	const [alternative, setAlternative] = useState(
		row ? toAmountInput(row.alternativeMonthlyMinor) : "",
	);
	const [status, setStatus] = useState<(typeof OPTIMIZATION_STATUSES)[number]>(
		completing ? "completed" : (row?.status ?? "idea"),
	);
	const [contractId, setContractId] = useState(
		row?.contractId ?? candidate?.contractId ?? "",
	);
	const [oneTime, setOneTime] = useState(
		toAmountInput(row?.oneTimeCostMinor ?? 0),
	);
	const preview = optimizationSavings({
		currentMonthlyMinor: parseAmountInput(current) ?? 0,
		alternativeMonthlyMinor: parseAmountInput(alternative) ?? 0,
		oneTimeCostMinor: parseAmountInput(oneTime) ?? 0,
	});
	const done = async () => {
		await invalidate();
		toast.success(row ? "Sparmission gespeichert" : "Sparmission angelegt");
		onClose();
	};
	const create = useMutation(
		orpc.optimizations.create.mutationOptions({
			onSuccess: done,
			onError: reportError,
		}),
	);
	const update = useMutation(
		orpc.optimizations.update.mutationOptions({
			onSuccess: done,
			onError: reportError,
		}),
	);
	const remove = useMutation(
		orpc.optimizations.delete.mutationOptions({
			onSuccess: done,
			onError: reportError,
		}),
	);
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				title={row ? row.title : "Sparmission anlegen"}
				description="Vergleiche die echten monatlichen Kosten. Die Vorschau reagiert sofort auf jede Eingabe."
			>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						const form = new FormData(event.currentTarget);
						const payload = {
							title: str(form, "title"),
							category: str(
								form,
								"category",
							) as (typeof OPTIMIZATION_CATEGORIES)[number],
							currency: str(form, "currency"),
							currentMonthlyMinor: parseAmountInput(current) ?? 0,
							alternativeMonthlyMinor: parseAmountInput(alternative) ?? 0,
							oneTimeCostMinor: parseAmountInput(oneTime) ?? 0,
							status,
							targetDate: optStr(form, "targetDate"),
							completedAt:
								status === "completed"
									? (optStr(form, "completedAt") ?? todayIso())
									: null,
							// Only asked while no contract owns the date; a hidden
							// field leaves the stored date alone.
							savingFrom:
								status === "completed" && !contractId
									? optStr(form, "savingFrom")
									: undefined,
							currentAccountId: optStr(form, "currentAccountId"),
							replacementAccountId: optStr(form, "replacementAccountId"),
							recurringPaymentId:
								row?.recurringPaymentId ??
								candidate?.recurringPaymentId ??
								null,
							contractId: contractId || null,
							notes: optStr(form, "notes"),
						};
						if (row) update.mutate({ id: row.id, ...payload });
						else create.mutate(payload);
					}}
					className="grid gap-3 sm:grid-cols-2"
				>
					<Field label="Mission" htmlFor="o-title" className="sm:col-span-2">
						<Input
							id="o-title"
							name="title"
							defaultValue={row?.title ?? candidate?.title ?? ""}
							required
							autoFocus
						/>
					</Field>
					<Field label="Bereich" htmlFor="o-category">
						<NativeSelect
							id="o-category"
							name="category"
							defaultValue={row?.category ?? candidate?.category ?? "other"}
						>
							{OPTIMIZATION_CATEGORIES.map((category) => (
								<option key={category} value={category}>
									{MISSION_CATEGORY_LABELS[category]}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field label="Währung" htmlFor="o-currency">
						<NativeSelect
							id="o-currency"
							name="currency"
							defaultValue={
								row?.currency ?? candidate?.currency ?? defaultCurrency
							}
						>
							{CURRENCIES.map((currency) => (
								<option key={currency}>{currency}</option>
							))}
						</NativeSelect>
					</Field>
					<Field label="Heute pro Monat" htmlFor="o-current">
						<Input
							id="o-current"
							value={current}
							onChange={(event) => setCurrent(event.target.value)}
							inputMode="decimal"
							className="amount"
							required
						/>
					</Field>
					<Field label="Alternative pro Monat" htmlFor="o-alternative">
						<Input
							id="o-alternative"
							value={alternative}
							onChange={(event) => setAlternative(event.target.value)}
							inputMode="decimal"
							className="amount"
							required
						/>
					</Field>
					<Field label="Einmalige Wechselkosten" htmlFor="o-onetime">
						<Input
							id="o-onetime"
							value={oneTime}
							onChange={(event) => setOneTime(event.target.value)}
							inputMode="decimal"
							className="amount"
						/>
					</Field>
					<Field label="Status" htmlFor="o-status">
						<NativeSelect
							id="o-status"
							name="status"
							value={status}
							onChange={(event) =>
								setStatus(
									event.target.value as (typeof OPTIMIZATION_STATUSES)[number],
								)
							}
						>
							{OPTIMIZATION_STATUSES.map((status) => (
								<option key={status} value={status}>
									{MISSION_STATUS_LABELS[status]}
								</option>
							))}
						</NativeSelect>
					</Field>
					<div className="surface sm:col-span-2 grid grid-cols-2 gap-3 p-3 sm:grid-cols-4">
						{parseAmountInput(alternative) === null ? (
							<p className="col-span-2 text-xs text-text-secondary sm:col-span-4">
								Trag ein, was die Alternative monatlich kostet — dann rechnet
								Fortuna hier aus, was der Wechsel bringt.
							</p>
						) : (
							<>
								<PreviewValue label="Monat" value={preview.monthlyMinor} />
								<PreviewValue label="1 Jahr" value={preview.firstYearMinor} />
								<PreviewValue label="3 Jahre" value={preview.threeYearsMinor} />
								<PreviewValue label="5 Jahre" value={preview.fiveYearsMinor} />
								{preview.paybackMonths !== null && preview.paybackMonths > 0 ? (
									<p className="col-span-2 text-xs text-text-secondary sm:col-span-4">
										Wechselkosten nach {f.number(preview.paybackMonths, 1)}{" "}
										Monaten wieder drin.
									</p>
								) : null}
								<p className="col-span-2 text-xs text-text-muted sm:col-span-4">
									Angenommen, Preise und Nutzung bleiben unverändert.
								</p>
							</>
						)}
					</div>
					<Field label="Aktuelles Konto" htmlFor="o-current-account">
						<NativeSelect
							id="o-current-account"
							name="currentAccountId"
							defaultValue={row?.currentAccountId ?? ""}
						>
							<option value="">Nicht verknüpft</option>
							{accounts.map((account) => (
								<option key={account.id} value={account.id}>
									{account.name}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field label="Alternative" htmlFor="o-replacement-account">
						<NativeSelect
							id="o-replacement-account"
							name="replacementAccountId"
							defaultValue={row?.replacementAccountId ?? ""}
						>
							<option value="">Nicht verknüpft</option>
							{accounts.map((account) => (
								<option key={account.id} value={account.id}>
									{account.name}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field
						label="Alter Vertrag"
						htmlFor="o-contract"
						className="sm:col-span-2"
						hint="Ist er verknüpft, beginnt die Ersparnis am Tag nach seinem Ende — nicht schon am Tag der Kündigung."
					>
						<NativeSelect
							id="o-contract"
							name="contractId"
							value={contractId}
							onChange={(event) => setContractId(event.target.value)}
						>
							<option value="">Nicht verknüpft</option>
							{contracts.map((contract) => (
								<option key={contract.id} value={contract.id}>
									{contract.name}
									{contract.costsUntil
										? ` — läuft bis ${contract.costsUntil}`
										: ""}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field label="Zieldatum" htmlFor="o-target">
						<Input
							id="o-target"
							name="targetDate"
							type="date"
							defaultValue={row?.targetDate ?? ""}
						/>
					</Field>
					<Field label="Umgesetzt am" htmlFor="o-completed">
						<Input
							id="o-completed"
							name="completedAt"
							type="date"
							defaultValue={row?.completedAt ?? (completing ? todayIso() : "")}
						/>
					</Field>
					{status === "completed" && !contractId ? (
						<Field
							label="Alte Kosten fallen weg ab"
							htmlFor="o-saving-from"
							className="sm:col-span-2"
							hint="Erst ab diesem Tag zählt die Ersparnis. Ohne Datum rechnet Fortuna noch nichts als gespart."
						>
							<Input
								id="o-saving-from"
								name="savingFrom"
								type="date"
								defaultValue={row?.savingFrom ?? ""}
								autoFocus={completing}
							/>
						</Field>
					) : null}
					<Field label="Notizen" htmlFor="o-notes" className="sm:col-span-2">
						<Textarea
							id="o-notes"
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
									if (confirm("Diese Sparmission löschen?"))
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
								<Sparkles /> Speichern
							</Button>
						</div>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function PreviewValue({ label, value }: { label: string; value: number }) {
	return (
		<div>
			<p className="label-caps">{label}</p>
			<p className="mt-1">
				<Money amountMinor={value} tone="auto" signed weight="medium" />
			</p>
		</div>
	);
}
