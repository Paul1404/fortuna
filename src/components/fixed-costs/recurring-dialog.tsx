import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
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
import { FREQUENCY_LABELS } from "@/lib/labels";
import { orpc } from "@/lib/orpc";
import { FREQUENCIES } from "@/lib/schemas";

export type RecurringRow = Awaited<
	ReturnType<typeof orpc.recurring.list.call>
>[number];

/** Create or edit one recurring payment. */
export function RecurringDialog({
	row,
	onClose,
	categories,
	accounts,
	defaultCurrency,
}: {
	row: RecurringRow | null;
	onClose: () => void;
	categories: { id: string; name: string; parentId: string | null }[];
	accounts: { id: string; name: string }[];
	defaultCurrency: string;
}) {
	const invalidate = useInvalidateAll();
	const done = async (msg: string) => {
		await invalidate();
		toast.success(msg);
		onClose();
	};
	const create = useMutation(
		orpc.recurring.create.mutationOptions({
			onSuccess: () => done("Wiederkehrende Zahlung hinzugefügt"),
			onError: reportError,
		}),
	);
	const update = useMutation(
		orpc.recurring.update.mutationOptions({
			onSuccess: () => done("Gespeichert"),
			onError: reportError,
		}),
	);
	const remove = useMutation(
		orpc.recurring.delete.mutationOptions({
			// A detected payment is switched off rather than deleted, or the next
			// import would detect it again.
			onSuccess: (result) =>
				done(result.deactivated ? "Deaktiviert" : "Gelöscht"),
			onError: reportError,
		}),
	);
	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent
				title={row ? row.name : "Wiederkehrende Zahlung hinzufügen"}
				description={
					row?.matchKey
						? "Automatisch erkannt. Verknüpfte Transaktionen bleiben beim Bearbeiten zugeordnet."
						: undefined
				}
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						const form = new FormData(e.currentTarget);
						const value = amount(form, "amount");
						if (value === null) return toast.error("Betrag eingeben");
						const direction = str(form, "direction") as "inflow" | "outflow";
						const payload = {
							name: str(form, "name"),
							accountId: optStr(form, "accountId"),
							categoryId: optStr(form, "categoryId"),
							direction,
							expectedAmountMinor:
								direction === "outflow" ? -Math.abs(value) : Math.abs(value),
							currency: str(form, "currency"),
							frequency: str(form, "frequency") as (typeof FREQUENCIES)[number],
							intervalDays: num(form, "intervalDays"),
							nextExpected: optStr(form, "nextExpected"),
							isActive: form.get("isActive") === "on",
							isSubscription: form.get("isSubscription") === "on",
							notes: optStr(form, "notes"),
						};
						if (row) update.mutate({ id: row.id, ...payload });
						else create.mutate(payload);
					}}
					className="grid gap-3 sm:grid-cols-2"
				>
					<Field label="Name" htmlFor="r-name" className="sm:col-span-2">
						<Input
							id="r-name"
							name="name"
							defaultValue={row?.name ?? ""}
							required
							autoFocus
						/>
					</Field>
					<Field label="Richtung" htmlFor="r-dir">
						<NativeSelect
							id="r-dir"
							name="direction"
							defaultValue={row?.direction ?? "outflow"}
						>
							<option value="outflow">Ausgabe</option>
							<option value="inflow">Einnahme</option>
						</NativeSelect>
					</Field>
					<Field label="Erwarteter Betrag" htmlFor="r-amount">
						<Input
							id="r-amount"
							name="amount"
							inputMode="decimal"
							defaultValue={
								row ? toAmountInput(Math.abs(row.expectedAmountMinor)) : ""
							}
							required
							className="amount"
						/>
					</Field>
					<Field label="Währung" htmlFor="r-cur">
						<NativeSelect
							id="r-cur"
							name="currency"
							defaultValue={row?.currency ?? defaultCurrency}
						>
							{CURRENCIES.map((c) => (
								<option key={c}>{c}</option>
							))}
						</NativeSelect>
					</Field>
					<Field label="Häufigkeit" htmlFor="r-freq">
						<NativeSelect
							id="r-freq"
							name="frequency"
							defaultValue={row?.frequency ?? "monthly"}
						>
							{FREQUENCIES.map((fq) => (
								<option key={fq} value={fq}>
									{FREQUENCY_LABELS[fq]}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field
						label="Intervall in Tagen"
						htmlFor="r-int"
						hint="Nur bei benutzerdefinierter Häufigkeit."
					>
						<Input
							id="r-int"
							name="intervalDays"
							type="number"
							min={1}
							defaultValue={row?.intervalDays ?? ""}
						/>
					</Field>
					<Field label="Nächste Fälligkeit" htmlFor="r-next">
						<Input
							id="r-next"
							name="nextExpected"
							type="date"
							defaultValue={row?.nextExpected ?? ""}
						/>
					</Field>
					<Field label="Konto" htmlFor="r-acc">
						<NativeSelect
							id="r-acc"
							name="accountId"
							defaultValue={row?.accountId ?? ""}
						>
							<option value="">Beliebig</option>
							{accounts.map((a) => (
								<option key={a.id} value={a.id}>
									{a.name}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field label="Kategorie" htmlFor="r-cat">
						<NativeSelect
							id="r-cat"
							name="categoryId"
							defaultValue={row?.categoryId ?? ""}
						>
							<option value="">Keine</option>
							{categories.map((c) => (
								<option key={c.id} value={c.id}>
									{c.parentId ? `  ${c.name}` : c.name}
								</option>
							))}
						</NativeSelect>
					</Field>
					<div className="flex flex-col gap-2 text-xs text-text-secondary sm:col-span-2">
						<label className="flex items-center gap-2">
							<input
								type="checkbox"
								name="isSubscription"
								defaultChecked={row?.isSubscription ?? false}
								className="accent-brand"
							/>{" "}
							Abonnement (kündbare Leistung)
						</label>
						<label className="flex items-center gap-2">
							<input
								type="checkbox"
								name="isActive"
								defaultChecked={row?.isActive ?? true}
								className="accent-brand"
							/>{" "}
							Aktiv (in der Prognose enthalten)
						</label>
					</div>
					<Field label="Notizen" htmlFor="r-notes" className="sm:col-span-2">
						<Textarea
							id="r-notes"
							name="notes"
							defaultValue={row?.notes ?? ""}
							rows={2}
						/>
					</Field>
					<div className="flex items-center justify-between gap-2 sm:col-span-2">
						{row ? (
							<Button
								type="button"
								variant="destructive"
								size="sm"
								onClick={() => {
									if (
										confirm(
											row.matchKey
												? "Diese erkannte Zahlung deaktivieren? Sie wird dann nicht erneut angelegt. Die Transaktionen bleiben erhalten."
												: "Diese wiederkehrende Zahlung löschen? Die Transaktionen bleiben erhalten.",
										)
									)
										remove.mutate({ id: row.id });
								}}
							>
								{row.matchKey ? "Deaktivieren" : "Löschen"}
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
