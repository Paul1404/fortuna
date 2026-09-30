import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { ContractRow } from "@/components/fixed-costs/contract-dialog";
import type { MissionRow } from "@/components/fixed-costs/mission-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { suggestedSavingDate } from "@/domain/optimization";
import { reportError, useInvalidateAll } from "@/lib/forms";
import { orpc } from "@/lib/orpc";

/**
 * "Datum fehlt" answered in place: the one date a Sparmission is waiting
 * for, prefilled, and nothing else. Without a linked contract that is the day
 * the old cost stops (`saving_from`); with one, the contract owns the date
 * (AGENTS: a contract owns the dates), so it is the contract's end that is
 * entered — on the contract.
 */
export function MissionDateDialog({
	mission,
	contract,
	onClose,
}: {
	mission: MissionRow;
	contract: ContractRow | null;
	onClose: () => void;
}) {
	const invalidate = useInvalidateAll();
	const missing =
		mission.progress.missing === "contract_end" && contract
			? "contract_end"
			: "saving_from";
	const [date, setDate] = useState(() =>
		suggestedSavingDate(missing, {
			completedAt: mission.completedAt,
			renewalDate: contract?.renewalDate ?? null,
		}),
	);
	const done = async () => {
		await invalidate();
		toast.success("Datum gespeichert");
		onClose();
	};
	const updateMission = useMutation(
		orpc.optimizations.update.mutationOptions({
			onSuccess: done,
			onError: reportError,
		}),
	);
	const updateContract = useMutation(
		orpc.contracts.update.mutationOptions({
			onSuccess: done,
			onError: reportError,
		}),
	);
	const pending = updateMission.isPending || updateContract.isPending;
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				title={
					missing === "contract_end"
						? `Wann endet ${contract?.name ?? "der alte Vertrag"}?`
						: "Ab wann fallen die alten Kosten weg?"
				}
				description={
					missing === "contract_end"
						? "Die Ersparnis beginnt am Tag danach."
						: "Erst ab diesem Tag zählt die Ersparnis."
				}
				className="max-w-sm"
			>
				<form
					className="grid gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (!date) return;
						if (missing === "contract_end" && contract)
							updateContract.mutate({ id: contract.id, endDate: date });
						else updateMission.mutate({ id: mission.id, savingFrom: date });
					}}
				>
					<Field
						label={missing === "contract_end" ? "Vertragsende" : "Wegfall ab"}
						htmlFor="mission-date"
					>
						<Input
							id="mission-date"
							type="date"
							required
							value={date}
							onChange={(event) => setDate(event.target.value)}
						/>
					</Field>
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							className="max-sm:h-11"
							onClick={onClose}
						>
							Abbrechen
						</Button>
						<Button
							type="submit"
							disabled={pending || !date}
							className="max-sm:h-11 max-sm:flex-1"
						>
							Speichern
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
