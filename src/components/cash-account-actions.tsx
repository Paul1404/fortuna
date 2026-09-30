import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AmountInput } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { todayIso } from "@/domain/dates";
import { balanceDateProblem, cashDescription } from "@/domain/settlement";
import { Money, useFormat } from "@/lib/format";
import { parseAmountInput, reportError, useInvalidateAll } from "@/lib/forms";
import { orpc } from "@/lib/orpc";

export type CashEntryMode = "outflow" | "inflow" | "count";

type CashAccount = {
	id: string;
	name: string;
	currency: string;
	currentBalanceMinor: number;
	balanceAsOf: string | null;
};

const TITLES: Record<CashEntryMode, string> = {
	outflow: "Ausgabe",
	inflow: "Einnahme",
	count: "Bestand zählen",
};

/**
 * Quick entries for a cash wallet, opened from its account page: a spend,
 * money coming in, or the counted amount. The amount comes first with the
 * numeric keypad already up; note, category and date are optional and the
 * date defaults to today. A spend or income is a booking through
 * `cash.recordMovement`; a count is a balance observation.
 */
export function CashEntryDialog({
	account,
	mode,
	onClose,
}: {
	account: CashAccount;
	mode: CashEntryMode;
	onClose: () => void;
}) {
	const f = useFormat();
	// Not suspending: the amount field must be there at once, and the
	// category list may arrive a moment later.
	const { data: categories = [] } = useQuery(
		orpc.categories.list.queryOptions(),
	);
	const invalidate = useInvalidateAll();
	const [text, setText] = useState("");
	const [note, setNote] = useState("");
	const [categoryId, setCategoryId] = useState("");
	const [date, setDate] = useState(todayIso());
	const [showDate, setShowDate] = useState(false);
	const today = todayIso();
	const parsed = parseAmountInput(text);
	const dateProblem = balanceDateProblem(date, {
		balanceAsOf: account.balanceAsOf,
		today,
	});
	const choices = categories.filter(
		(category) => category.kind === (mode === "inflow" ? "income" : "expense"),
	);
	const after =
		parsed === null
			? null
			: mode === "count"
				? parsed
				: account.currentBalanceMinor + (mode === "outflow" ? -parsed : parsed);
	const done = async (message: string) => {
		await invalidate();
		toast.success(message);
		onClose();
	};
	const movement = useMutation(
		orpc.cash.recordMovement.mutationOptions({
			onSuccess: () =>
				done(mode === "outflow" ? "Ausgabe erfasst" : "Einnahme erfasst"),
			onError: reportError,
		}),
	);
	const count = useMutation(
		orpc.accounts.recordBalance.mutationOptions({
			onSuccess: () => done("Bargeldbestand aktualisiert"),
			onError: reportError,
		}),
	);
	const pending = movement.isPending || count.isPending;
	const invalid =
		parsed === null ||
		parsed < 0 ||
		(mode !== "count" && parsed === 0) ||
		(after !== null && after < 0) ||
		Boolean(dateProblem);

	return (
		<Dialog open onOpenChange={(value) => !value && onClose()}>
			<DialogContent title={TITLES[mode]} description={account.name}>
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (invalid || parsed === null) return;
						if (mode === "count") {
							count.mutate({
								accountId: account.id,
								date,
								balanceMinor: parsed,
							});
							return;
						}
						const category = choices.find((c) => c.id === categoryId);
						movement.mutate({
							accountId: account.id,
							date,
							amountMinor: mode === "outflow" ? -parsed : parsed,
							description: cashDescription(note, category?.name, mode),
							categoryId: categoryId || null,
							notes: null,
						});
					}}
				>
					<AmountInput
						id="cash-entry-amount"
						label={mode === "count" ? "Gezählter Bestand" : "Betrag"}
						value={text}
						onChange={setText}
						currency={account.currency}
					/>
					<div
						className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm"
						aria-live="polite"
					>
						<span className="text-text-secondary">
							Bisher {f.money(account.currentBalanceMinor, account.currency)}
						</span>
						{after !== null ? (
							<span>
								{mode === "count" ? "Differenz " : "Danach "}
								<Money
									amountMinor={
										mode === "count"
											? after - account.currentBalanceMinor
											: after
									}
									currency={account.currency}
									signed={mode === "count"}
									tone={
										after < 0
											? "negative"
											: mode === "count"
												? "auto"
												: "default"
									}
								/>
							</span>
						) : null}
					</div>
					{after !== null && after < 0 ? (
						<p className="-mt-2 text-xs text-negative" role="alert">
							Mehr als im Bestand ist.
						</p>
					) : null}
					{mode !== "count" ? (
						<div className="grid gap-4 min-[430px]:grid-cols-2">
							<Field label="Wofür? (optional)" htmlFor="cash-entry-note">
								<Input
									id="cash-entry-note"
									value={note}
									onChange={(event) => setNote(event.target.value)}
									autoComplete="off"
									enterKeyHint="done"
									placeholder={
										mode === "outflow" ? "z. B. Bäcker" : "z. B. Geldautomat"
									}
								/>
							</Field>
							<Field label="Kategorie (optional)" htmlFor="cash-entry-category">
								<NativeSelect
									id="cash-entry-category"
									value={categoryId}
									onChange={(event) => setCategoryId(event.target.value)}
								>
									<option value="">Keine</option>
									{choices.map((category) => (
										<option key={category.id} value={category.id}>
											{category.name}
										</option>
									))}
								</NativeSelect>
							</Field>
						</div>
					) : null}
					{showDate || date !== today ? (
						<Field label="Datum" htmlFor="cash-entry-date" error={dateProblem}>
							<Input
								id="cash-entry-date"
								type="date"
								value={date}
								min={account.balanceAsOf ?? undefined}
								max={today}
								onChange={(event) => setDate(event.target.value)}
								required
							/>
						</Field>
					) : (
						<button
							type="button"
							onClick={() => setShowDate(true)}
							className="flex min-h-11 items-center gap-1 text-sm text-text-secondary hover:text-text"
						>
							<ChevronDown className="size-4" aria-hidden />
							Heute · anderes Datum
						</button>
					)}
					<Button
						type="submit"
						size="lg"
						className="w-full"
						disabled={pending || invalid}
					>
						{mode === "count" ? "Bestand übernehmen" : "Speichern"}
					</Button>
				</form>
			</DialogContent>
		</Dialog>
	);
}
