import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { AmountInput, Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { amountInputText } from "@/domain/settlement";
import {
	amount,
	optStr,
	reportError,
	str,
	useInvalidateAll,
} from "@/lib/forms";
import { orpc } from "@/lib/orpc";

type Booking = Awaited<ReturnType<typeof orpc.transactions.get.call>>;

export function TransactionReceivable({
	booking,
	onClose,
}: {
	booking: Booking;
	onClose: () => void;
}) {
	const [open, setOpen] = useState(false);
	const invalidate = useInvalidateAll();
	const create = useMutation(
		orpc.receivables.fromTransaction.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Forderung angelegt");
				onClose();
			},
			onError: reportError,
		}),
	);
	if (booking.receivableId)
		return (
			<Link
				to="/debts"
				search={{ highlight: booking.receivableId }}
				className="text-sm text-brand"
			>
				Forderung öffnen
			</Link>
		);
	if (booking.amountMinor >= 0 || booking.transferGroupId) return null;
	if (booking.status !== "booked")
		return (
			<p className="text-xs text-text-muted">
				Eine Forderung können Sie anlegen, sobald die Ausgabe gebucht ist.
			</p>
		);
	return (
		<section className="space-y-3 border-t border-border pt-3">
			{!open ? (
				<Button type="button" variant="outline" onClick={() => setOpen(true)}>
					Als Forderung anlegen
				</Button>
			) : (
				<form
					className="grid gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						const form = new FormData(event.currentTarget);
						const amountMinor = amount(form, "amount");
						if (
							amountMinor === null ||
							amountMinor <= 0 ||
							amountMinor > -booking.amountMinor
						) {
							toast.error(
								"Bitte einen Betrag bis zur Höhe der Ausgabe eingeben.",
							);
							return;
						}
						create.mutate({
							transactionId: booking.id,
							name: str(form, "name"),
							debtorName: str(form, "debtor"),
							amountMinor,
							dueDate: optStr(form, "dueDate"),
						});
					}}
				>
					<h3 className="label-caps">Forderung aus dieser Ausgabe</h3>
					<p className="text-xs text-text-secondary">
						Die Ausgabe bleibt erhalten. Die Forderung zählt ab dem
						Buchungsdatum als Vermögen, bis sie beglichen ist.
					</p>
					<Field label="Bezeichnung" htmlFor="receivable-name">
						<Input
							id="receivable-name"
							name="name"
							required
							maxLength={200}
							defaultValue={(booking.merchantName ?? booking.description).slice(
								0,
								200,
							)}
						/>
					</Field>
					<Field
						label="Wer schuldet Ihnen das Geld?"
						htmlFor="receivable-debtor"
					>
						<Input
							id="receivable-debtor"
							name="debtor"
							required
							maxLength={200}
						/>
					</Field>
					<Field
						label={`Betrag (${booking.currency})`}
						htmlFor="receivable-amount"
					>
						<AmountInput
							id="receivable-amount"
							name="amount"
							required
							defaultValue={amountInputText(-booking.amountMinor)}
						/>
					</Field>
					<Field label="Fällig am (optional)" htmlFor="receivable-due">
						<Input id="receivable-due" name="dueDate" type="date" />
					</Field>
					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							disabled={create.isPending}
							onClick={() => setOpen(false)}
						>
							Abbrechen
						</Button>
						<Button type="submit" disabled={create.isPending}>
							Forderung anlegen
						</Button>
					</DialogFooter>
				</form>
			)}
		</section>
	);
}
