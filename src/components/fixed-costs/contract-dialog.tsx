import { useMutation } from "@tanstack/react-query";
import { Paperclip } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import {
	amount,
	CURRENCIES,
	optStr,
	reportError,
	str,
	toAmountInput,
	useInvalidateAll,
} from "@/lib/forms";
import { orpc } from "@/lib/orpc";

export const CONTRACT_CATEGORY_LABELS: Record<string, string> = {
	insurance: "Versicherung",
	utilities: "Versorgung",
	telecom: "Telefon & Internet",
	subscription: "Abo",
	banking: "Bank & Karte",
	housing: "Wohnen",
	mobility: "Mobilität",
	other: "Sonstiges",
};
export const CONTRACT_FREQUENCY_LABELS: Record<string, string> = {
	weekly: "wöchentlich",
	biweekly: "zweiwöchentlich",
	monthly: "monatlich",
	bimonthly: "zweimonatlich",
	quarterly: "vierteljährlich",
	semiannual: "halbjährlich",
	yearly: "jährlich",
	custom: "individuell",
};
export const DOCUMENT_LABELS: Record<string, string> = {
	contract: "Vertrag",
	policy: "Versicherungsschein",
	invoice: "Rechnung",
	terms: "Bedingungen",
	cancellation: "Kündigung",
	other: "Sonstiges",
};

export type ContractRow = Awaited<
	ReturnType<typeof orpc.contracts.list.call>
>[number];

/** Defaults for a new contract taken from the item it is created for. */
export type ContractPreset = {
	name?: string;
	costMinor?: number | null;
	frequency?: string | null;
	accountId?: string | null;
	recurringPaymentId?: string | null;
};

/** Upload one document and file it on the contract. */
export function DocumentUpload({
	contractId,
	defaultType,
}: {
	contractId: string;
	defaultType: string;
}) {
	const invalidate = useInvalidateAll();
	const [busy, setBusy] = useState(false);
	const attach = useMutation(
		orpc.contracts.attachDocument.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Dokument am Vertrag abgelegt");
			},
			onError: reportError,
		}),
	);
	return (
		<form
			className="flex flex-wrap items-end gap-2"
			onSubmit={async (event) => {
				event.preventDefault();
				const form = event.currentTarget;
				const data = new FormData(form);
				const file = data.get("file");
				if (!(file instanceof File) || !file.size) return;
				setBusy(true);
				try {
					const upload = new FormData();
					upload.append("files", file);
					const response = await fetch("/api/copilot/attachments", {
						method: "POST",
						body: upload,
					});
					if (!response.ok) throw new Error(await response.text());
					const payload = (await response.json()) as {
						attachments: { id: string }[];
					};
					await attach.mutateAsync({
						contractId,
						attachmentId: payload.attachments[0].id,
						type: str(data, "type") as
							| "contract"
							| "policy"
							| "invoice"
							| "terms"
							| "cancellation"
							| "other",
					});
					form.reset();
				} catch (error) {
					reportError(error);
				} finally {
					setBusy(false);
				}
			}}
		>
			<NativeSelect
				name="type"
				defaultValue={defaultType}
				aria-label="Dokumentart"
				className="w-auto"
			>
				{Object.entries(DOCUMENT_LABELS).map(([value, label]) => (
					<option key={value} value={value}>
						{label}
					</option>
				))}
			</NativeSelect>
			<Input
				name="file"
				type="file"
				aria-label="Vertragsdokument auswählen"
				required
				className="min-w-48 flex-1 pt-1"
				accept="application/pdf,image/png,image/jpeg,image/webp,image/gif,text/plain,text/markdown,text/csv,text/tab-separated-values,application/json,application/xml,text/xml"
			/>
			<Button
				type="submit"
				variant="outline"
				disabled={busy || attach.isPending}
			>
				<Paperclip /> Anhängen
			</Button>
		</form>
	);
}

/** Create or edit one contract. */
export function ContractDialog({
	value,
	preset,
	accounts,
	recurring,
	defaultCurrency,
	onClose,
}: {
	value: ContractRow | null;
	preset?: ContractPreset;
	accounts: { id: string; name: string }[];
	recurring: { id: string; name: string }[];
	defaultCurrency: string;
	onClose: () => void;
}) {
	const invalidate = useInvalidateAll();
	const create = useMutation(
		orpc.contracts.create.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Vertrag gespeichert");
				onClose();
			},
			onError: reportError,
		}),
	);
	const update = useMutation(
		orpc.contracts.update.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Vertrag gespeichert");
				onClose();
			},
			onError: reportError,
		}),
	);
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				title={value ? "Vertrag bearbeiten" : "Vertrag anlegen"}
				description="Je vollständiger die Angaben und Dokumente, desto zuverlässiger kann Herr Körner damit arbeiten."
			>
				<form
					className="grid gap-3 sm:grid-cols-2"
					onSubmit={(event) => {
						event.preventDefault();
						const form = new FormData(event.currentTarget);
						const input = {
							name: str(form, "name"),
							provider: optStr(form, "provider"),
							contractNumber: optStr(form, "contractNumber"),
							category: str(form, "category") as
								| "insurance"
								| "utilities"
								| "telecom"
								| "subscription"
								| "banking"
								| "housing"
								| "mobility"
								| "other",
							status: str(form, "status") as "active" | "cancelled" | "ended",
							costMinor: amount(form, "cost"),
							currency: str(form, "currency"),
							frequency: (optStr(form, "frequency") ?? null) as
								| "weekly"
								| "biweekly"
								| "monthly"
								| "bimonthly"
								| "quarterly"
								| "semiannual"
								| "yearly"
								| "custom"
								| null,
							startDate: optStr(form, "startDate"),
							endDate: optStr(form, "endDate"),
							renewalDate: optStr(form, "renewalDate"),
							cancellationDate: optStr(form, "cancellationDate"),
							noticePeriodDays: form.get("noticePeriodDays")
								? Number(form.get("noticePeriodDays"))
								: null,
							accountId: optStr(form, "accountId"),
							recurringPaymentId: optStr(form, "recurringPaymentId"),
							paidVia: (form.get("paidViaPayroll") ? "payroll" : "account") as
								| "account"
								| "payroll",
							notes: optStr(form, "notes"),
						};
						if (value) update.mutate({ id: value.id, ...input });
						else create.mutate(input);
					}}
				>
					<Field label="Name" htmlFor="contract-name">
						<Input
							id="contract-name"
							name="name"
							defaultValue={value?.name ?? preset?.name ?? ""}
							required
							autoFocus
						/>
					</Field>
					<Field label="Anbieter" htmlFor="contract-provider">
						<Input
							id="contract-provider"
							name="provider"
							defaultValue={value?.provider ?? ""}
						/>
					</Field>
					<Field label="Kategorie" htmlFor="contract-category">
						<NativeSelect
							id="contract-category"
							name="category"
							defaultValue={value?.category ?? "other"}
						>
							{Object.entries(CONTRACT_CATEGORY_LABELS).map(([key, label]) => (
								<option key={key} value={key}>
									{label}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field label="Status" htmlFor="contract-status">
						<NativeSelect
							id="contract-status"
							name="status"
							defaultValue={value?.status ?? "active"}
						>
							<option value="active">Aktiv</option>
							<option value="cancelled">Gekündigt</option>
							<option value="ended">Beendet</option>
						</NativeSelect>
					</Field>
					<Field label="Vertragsnummer" htmlFor="contract-number">
						<Input
							id="contract-number"
							name="contractNumber"
							defaultValue={value?.contractNumber ?? ""}
						/>
					</Field>
					<Field label="Kosten" htmlFor="contract-cost">
						<Input
							id="contract-cost"
							name="cost"
							inputMode="decimal"
							defaultValue={toAmountInput(
								value ? value.costMinor : preset?.costMinor,
							)}
						/>
					</Field>
					<Field label="Währung" htmlFor="contract-currency">
						<NativeSelect
							id="contract-currency"
							name="currency"
							defaultValue={value?.currency ?? defaultCurrency}
						>
							{CURRENCIES.map((code) => (
								<option key={code}>{code}</option>
							))}
						</NativeSelect>
					</Field>
					<Field label="Turnus" htmlFor="contract-frequency">
						<NativeSelect
							id="contract-frequency"
							name="frequency"
							defaultValue={
								value
									? (value.frequency ?? "")
									: (preset?.frequency ?? "monthly")
							}
						>
							<option value="">Nicht angegeben</option>
							{Object.entries(CONTRACT_FREQUENCY_LABELS).map(([key, label]) => (
								<option key={key} value={key}>
									{label}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field label="Beginn" htmlFor="contract-start">
						<Input
							id="contract-start"
							name="startDate"
							type="date"
							defaultValue={value?.startDate ?? ""}
						/>
					</Field>
					<Field label="Ende" htmlFor="contract-end">
						<Input
							id="contract-end"
							name="endDate"
							type="date"
							defaultValue={value?.endDate ?? ""}
						/>
					</Field>
					<Field label="Verlängerung" htmlFor="contract-renewal">
						<Input
							id="contract-renewal"
							name="renewalDate"
							type="date"
							defaultValue={value?.renewalDate ?? ""}
						/>
					</Field>
					<Field label="Gekündigt zum" htmlFor="contract-cancellation">
						<Input
							id="contract-cancellation"
							name="cancellationDate"
							type="date"
							defaultValue={value?.cancellationDate ?? ""}
						/>
					</Field>
					<Field label="Kündigungsfrist in Tagen" htmlFor="contract-notice">
						<Input
							id="contract-notice"
							name="noticePeriodDays"
							type="number"
							min={0}
							defaultValue={value?.noticePeriodDays ?? ""}
						/>
					</Field>
					<Field label="Konto" htmlFor="contract-account">
						<NativeSelect
							id="contract-account"
							name="accountId"
							defaultValue={value?.accountId ?? preset?.accountId ?? ""}
						>
							<option value="">Nicht verknüpft</option>
							{accounts.map((account) => (
								<option key={account.id} value={account.id}>
									{account.name}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field label="Wiederkehrende Zahlung" htmlFor="contract-recurring">
						<NativeSelect
							id="contract-recurring"
							name="recurringPaymentId"
							defaultValue={
								value?.recurringPaymentId ?? preset?.recurringPaymentId ?? ""
							}
						>
							<option value="">Nicht verknüpft</option>
							{recurring.map((item) => (
								<option key={item.id} value={item.id}>
									{item.name}
								</option>
							))}
						</NativeSelect>
					</Field>
					<label className="flex items-start gap-2 text-sm text-text sm:col-span-2 pointer-coarse:min-h-11 pointer-coarse:items-center">
						<input
							type="checkbox"
							name="paidViaPayroll"
							defaultChecked={value?.paidVia === "payroll"}
							className="mt-0.5 size-4 shrink-0 accent-brand pointer-coarse:mt-0 pointer-coarse:size-5"
						/>
						<span className="min-w-0">
							Wird über das Gehalt bezahlt (Entgeltumwandlung)
							<span className="block text-xs text-text-muted">
								Der Arbeitgeber zahlt; es geht nichts vom Konto ab.
							</span>
						</span>
					</label>
					<Field
						label="Notizen"
						htmlFor="contract-notes"
						className="sm:col-span-2"
					>
						<Textarea
							id="contract-notes"
							name="notes"
							defaultValue={value?.notes ?? ""}
						/>
					</Field>
					<div className="flex justify-end gap-2 sm:col-span-2">
						<Button type="button" variant="ghost" onClick={onClose}>
							Abbrechen
						</Button>
						<Button type="submit">Speichern</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
