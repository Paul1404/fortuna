import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AmountInput } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { todayIso } from "@/domain/dates";
import { amountInputText } from "@/domain/settlement";
import { Money, useFormat } from "@/lib/format";
import { parseAmountInput, reportError, useInvalidateAll } from "@/lib/forms";
import { VALUATION_SOURCE_LABELS } from "@/lib/labels";
import { orpc } from "@/lib/orpc";
import { VALUATION_SOURCES } from "@/lib/schemas";

/**
 * Updating what a Sachwert is worth: the new value, dated today unless the
 * owner says otherwise, saved as a valuation in its history. The desk's
 * stale-value tasks and a tap on an asset row both land here.
 */
export function AssetValueDialog({
	asset,
	onClose,
	showDetailsLink = false,
}: {
	asset: {
		id: string;
		name: string;
		currency: string;
		currentValueMinor: number;
		valuationDate: string | null;
	};
	onClose: () => void;
	showDetailsLink?: boolean;
}) {
	const f = useFormat();
	const invalidate = useInvalidateAll();
	const [text, setText] = useState(amountInputText(asset.currentValueMinor));
	const [date, setDate] = useState(todayIso());
	const [more, setMore] = useState(false);
	const [source, setSource] =
		useState<(typeof VALUATION_SOURCES)[number]>("manual");
	const [notes, setNotes] = useState("");
	const today = todayIso();
	const parsed = parseAmountInput(text);
	const diff = parsed === null ? null : parsed - asset.currentValueMinor;
	const save = useMutation(
		orpc.assets.addValuation.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success(`${asset.name}: Wert aktualisiert`);
				onClose();
			},
			onError: reportError,
		}),
	);
	return (
		<Dialog open onOpenChange={(value) => !value && onClose()}>
			<DialogContent
				title={asset.name}
				description={
					asset.valuationDate
						? `Zuletzt bewertet am ${f.date(asset.valuationDate)}`
						: "Noch ohne Bewertung"
				}
			>
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (parsed === null || parsed < 0)
							return toast.error("Wert eingeben");
						save.mutate({
							assetId: asset.id,
							date: date || today,
							valueMinor: parsed,
							source,
							notes: notes.trim() || null,
						});
					}}
				>
					<AmountInput
						id="asset-value"
						label="Neuer Wert"
						value={text}
						onChange={setText}
						currency={asset.currency}
					/>
					<p className="-mt-2 text-sm text-text-secondary" aria-live="polite">
						Bisher {f.money(asset.currentValueMinor, asset.currency)}
						{diff ? (
							<>
								{" · "}
								<Money
									amountMinor={diff}
									currency={asset.currency}
									signed
									tone="auto"
								/>
							</>
						) : null}
					</p>
					<Field label="Datum" htmlFor="asset-value-date">
						<Input
							id="asset-value-date"
							type="date"
							value={date}
							max={today}
							onChange={(event) => setDate(event.target.value)}
							required
						/>
					</Field>
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
						Quelle und Notiz
					</button>
					{more ? (
						<div className="grid gap-4">
							<Field label="Quelle" htmlFor="asset-value-source">
								<NativeSelect
									id="asset-value-source"
									value={source}
									onChange={(event) =>
										setSource(
											event.target.value as (typeof VALUATION_SOURCES)[number],
										)
									}
								>
									{VALUATION_SOURCES.map((s) => (
										<option key={s} value={s}>
											{VALUATION_SOURCE_LABELS[s] ?? "—"}
										</option>
									))}
								</NativeSelect>
							</Field>
							<Field label="Notiz" htmlFor="asset-value-notes">
								<Textarea
									id="asset-value-notes"
									rows={2}
									value={notes}
									onChange={(event) => setNotes(event.target.value)}
									placeholder="z. B. Chrono24-Median"
								/>
							</Field>
						</div>
					) : null}
					<Button
						type="submit"
						size="lg"
						className="w-full"
						disabled={save.isPending || parsed === null}
					>
						Speichern
					</Button>
					{showDetailsLink ? (
						<Link
							to="/assets/$id"
							params={{ id: asset.id }}
							className="flex min-h-11 items-center justify-center text-sm text-brand hover:underline"
						>
							Details und Verlauf
						</Link>
					) : null}
				</form>
			</DialogContent>
		</Dialog>
	);
}
