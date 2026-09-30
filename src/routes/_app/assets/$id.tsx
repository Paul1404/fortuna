import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AssetValueDialog } from "@/components/asset-value-dialog";
import { LineChart } from "@/components/charts/line-chart";
import { PageHeader } from "@/components/page-header";
import { StatRow, StatTile } from "@/components/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { daysBetween, todayIso } from "@/domain/dates";
import { percentChange } from "@/domain/money";
import { Money, useFormat } from "@/lib/format";
import {
	amount,
	optStr,
	reportError,
	str,
	toAmountInput,
	useInvalidateAll,
} from "@/lib/forms";
import { ASSET_CATEGORY_LABELS, VALUATION_SOURCE_LABELS } from "@/lib/labels";
import { orpc } from "@/lib/orpc";
import { ASSET_CATEGORIES } from "@/lib/schemas";

export const Route = createFileRoute("/_app/assets/$id")({
	// `?update=1` opens the value update at once, for links whose only
	// purpose is a new value (the desk's stale-value tasks).
	validateSearch: (raw: Record<string, unknown>): { update?: true } =>
		raw.update === true || raw.update === "1" || raw.update === 1
			? { update: true }
			: {},
	loader: ({ context, params }) =>
		context.queryClient.ensureQueryData(
			orpc.assets.get.queryOptions({ input: { id: params.id } }),
		),
	head: () => ({ meta: [{ title: "Sachwert · Fortuna" }] }),
	component: AssetDetail,
});

function AssetDetail() {
	const { id } = Route.useParams();
	const { data: asset } = useSuspenseQuery(
		orpc.assets.get.queryOptions({ input: { id } }),
	);
	const f = useFormat();
	const navigate = useNavigate();
	const invalidate = useInvalidateAll();
	const [edit, setEdit] = useState(false);
	const { update: openUpdate } = Route.useSearch();
	const [valuing, setValuingState] = useState(Boolean(openUpdate));
	const setValuing = (value: boolean) => {
		setValuingState(value);
		// A link that opened the update must not reopen it on reload.
		if (!value && openUpdate)
			navigate({
				to: "/assets/$id",
				params: { id },
				search: {},
				replace: true,
			});
	};
	const update = useMutation(
		orpc.assets.update.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Gespeichert");
				setEdit(false);
			},
			onError: reportError,
		}),
	);
	const remove = useMutation(
		orpc.assets.delete.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Sachwert gelöscht");
				navigate({ to: "/assets" });
			},
			onError: reportError,
		}),
	);
	const delVal = useMutation(
		orpc.assets.deleteValuation.mutationOptions({
			onSuccess: () => invalidate(),
			onError: reportError,
		}),
	);
	const gain =
		asset.acquisitionCostMinor !== null
			? asset.currentValueMinor - asset.acquisitionCostMinor
			: null;
	const pct = asset.acquisitionCostMinor
		? percentChange(asset.acquisitionCostMinor, asset.currentValueMinor)
		: null;
	const heldDays = asset.acquisitionDate
		? daysBetween(asset.acquisitionDate, asset.disposedAt ?? todayIso())
		: null;
	const annualised =
		pct !== null && heldDays && heldDays > 30 && asset.acquisitionCostMinor
			? ((asset.currentValueMinor / asset.acquisitionCostMinor) **
					(365 / heldDays) -
					1) *
				100
			: null;

	return (
		<div className="space-y-5">
			<PageHeader
				title={asset.name}
				subtitle={
					<span className="flex flex-wrap items-center gap-2">
						<Link to="/assets" className="text-brand hover:underline">
							Sachwerte
						</Link>
						<span>·</span>
						{ASSET_CATEGORY_LABELS[asset.category]} · {asset.currency}
						{asset.reference ? (
							<span className="font-mono text-xs">{asset.reference}</span>
						) : null}
						{!asset.isActive ? (
							<Badge>
								veräußert {asset.disposedAt ? f.date(asset.disposedAt) : ""}
							</Badge>
						) : null}
					</span>
				}
				actions={
					<>
						<Button onClick={() => setValuing(true)}>
							<RefreshCw /> Wert aktualisieren
						</Button>
						<Button variant="outline" onClick={() => setEdit(true)}>
							<Pencil /> Bearbeiten
						</Button>
					</>
				}
			/>
			<StatRow className="xl:grid-cols-4">
				<StatTile
					label="Aktueller Wert"
					value={
						<Money
							amountMinor={asset.currentValueMinor}
							currency={asset.currency}
							className="text-[22px]"
						/>
					}
					detail={
						<span className="text-text-muted">
							bewertet {asset.valuationDate ? f.date(asset.valuationDate) : "—"}
						</span>
					}
				/>
				<StatTile
					label="Kaufpreis"
					value={
						asset.acquisitionCostMinor !== null ? (
							<Money
								amountMinor={asset.acquisitionCostMinor}
								currency={asset.currency}
								className="text-[22px]"
							/>
						) : (
							"—"
						)
					}
					detail={
						<span className="text-text-muted">
							{asset.acquisitionDate
								? f.date(asset.acquisitionDate)
								: "Datum unbekannt"}
						</span>
					}
				/>
				<StatTile
					label="Veränderung seit Kauf"
					value={
						gain !== null ? (
							<Money
								amountMinor={gain}
								currency={asset.currency}
								tone="auto"
								signed
								className="text-[22px]"
							/>
						) : (
							"—"
						)
					}
					detail={
						<span className="text-text-muted">
							{pct === null ? "" : f.percent(pct)}
							{annualised !== null ? ` · ${f.percent(annualised)} p.a.` : ""}
						</span>
					}
				/>
				<StatTile
					label="Haltedauer"
					value={
						heldDays !== null ? `${f.number(heldDays / 365, 1)} Jahre` : "—"
					}
					detail={
						<span className="text-text-muted">
							{asset.valuations.length} Bewertungen
						</span>
					}
				/>
			</StatRow>
			<Card>
				<CardHeader
					title="Bewertungsverlauf"
					subtitle="Jeder Wert fließt ab seinem Datum in den Verlauf des Nettovermögens ein"
				/>
				<CardBody>
					<LineChart
						ariaLabel={`Bewertungsverlauf von ${asset.name}`}
						series={[
							{
								key: "v",
								label: "Wert",
								points: asset.valuations.map((v) => ({
									x: v.date,
									y: v.valueMinor,
								})),
								area: true,
							},
						]}
						currency={asset.currency}
						height={220}
						zeroLine={false}
					/>
				</CardBody>
				{/* A list, not a table: five columns did not fit a phone and cut
				    the change column off at the edge. */}
				<ul className="border-t border-border">
					{[...asset.valuations].reverse().map((v, i, arr) => {
						const prev = arr[i + 1];
						return (
							<li
								key={v.id}
								className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
							>
								<div className="min-w-0 flex-1">
									<p className="text-sm text-text">{f.date(v.date)}</p>
									<p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
										<Badge>{VALUATION_SOURCE_LABELS[v.source] ?? "—"}</Badge>
										{v.notes ? (
											<span className="break-words">{v.notes}</span>
										) : null}
									</p>
								</div>
								<div className="shrink-0 text-right">
									<Money amountMinor={v.valueMinor} currency={asset.currency} />
									{prev ? (
										<Money
											amountMinor={v.valueMinor - prev.valueMinor}
											currency={asset.currency}
											tone="auto"
											signed
											weight="medium"
											className="block text-xs"
										/>
									) : null}
								</div>
								<Button
									variant="ghost"
									size="icon-sm"
									className="text-text-muted"
									aria-label={`Bewertung vom ${f.date(v.date)} löschen`}
									disabled={asset.valuations.length <= 1}
									onClick={() => {
										if (confirm("Diese Bewertung löschen?"))
											delVal.mutate({ id: v.id });
									}}
								>
									<Trash2 />
								</Button>
							</li>
						);
					})}
				</ul>
			</Card>
			{asset.notes ? (
				<Card>
					<CardHeader title="Notizen" />
					<CardBody className="whitespace-pre-wrap text-[13px] text-text-secondary">
						{asset.notes}
					</CardBody>
				</Card>
			) : null}

			{valuing ? (
				<AssetValueDialog asset={asset} onClose={() => setValuing(false)} />
			) : null}

			<Dialog open={edit} onOpenChange={setEdit}>
				<DialogContent title="Sachwert bearbeiten">
					<form
						onSubmit={(e) => {
							e.preventDefault();
							const form = new FormData(e.currentTarget);
							update.mutate({
								id,
								name: str(form, "name"),
								category: str(
									form,
									"category",
								) as (typeof ASSET_CATEGORIES)[number],
								acquisitionDate: optStr(form, "acquisitionDate"),
								acquisitionCostMinor: amount(form, "acquisitionCost"),
								reference: optStr(form, "reference"),
								notes: optStr(form, "notes"),
								isActive: form.get("isActive") === "on",
								disposedAt:
									form.get("isActive") === "on"
										? null
										: optStr(form, "disposedAt") || todayIso(),
							});
						}}
						className="grid gap-3 sm:grid-cols-2"
					>
						<Field label="Name" htmlFor="ea-name" className="sm:col-span-2">
							<Input
								id="ea-name"
								name="name"
								defaultValue={asset.name}
								required
							/>
						</Field>
						<Field label="Kategorie" htmlFor="ea-cat">
							<NativeSelect
								id="ea-cat"
								name="category"
								defaultValue={asset.category}
							>
								{ASSET_CATEGORIES.map((c) => (
									<option key={c} value={c}>
										{ASSET_CATEGORY_LABELS[c]}
									</option>
								))}
							</NativeSelect>
						</Field>
						<Field label="Referenz" htmlFor="ea-ref">
							<Input
								id="ea-ref"
								name="reference"
								defaultValue={asset.reference ?? ""}
								className="font-mono"
							/>
						</Field>
						<Field label="Kaufpreis" htmlFor="ea-cost">
							<Input
								id="ea-cost"
								name="acquisitionCost"
								inputMode="decimal"
								defaultValue={toAmountInput(asset.acquisitionCostMinor)}
								className="amount"
							/>
						</Field>
						<Field label="Kaufdatum" htmlFor="ea-adate">
							<Input
								id="ea-adate"
								name="acquisitionDate"
								type="date"
								defaultValue={asset.acquisitionDate ?? ""}
							/>
						</Field>
						<label className="flex items-center gap-2 text-xs text-text-secondary">
							<input
								type="checkbox"
								name="isActive"
								defaultChecked={asset.isActive}
								className="accent-brand"
							/>{" "}
							Noch im Besitz
						</label>
						<Field
							label="Veräußert am"
							htmlFor="ea-disp"
							hint="Wird verwendet, wenn der Sachwert nicht mehr im Besitz ist."
						>
							<Input
								id="ea-disp"
								name="disposedAt"
								type="date"
								defaultValue={asset.disposedAt ?? ""}
							/>
						</Field>
						<Field label="Notizen" htmlFor="ea-notes" className="sm:col-span-2">
							<Textarea
								id="ea-notes"
								name="notes"
								defaultValue={asset.notes ?? ""}
								rows={3}
							/>
						</Field>
						<div className="flex items-center justify-between sm:col-span-2">
							<Button
								type="button"
								variant="destructive"
								size="sm"
								onClick={() => {
									if (
										confirm(
											"Diesen Sachwert mit seinem Bewertungsverlauf löschen?",
										)
									)
										remove.mutate({ id });
								}}
							>
								Löschen
							</Button>
							<div className="flex gap-2">
								<Button
									type="button"
									variant="ghost"
									onClick={() => setEdit(false)}
								>
									Abbrechen
								</Button>
								<Button type="submit" disabled={update.isPending}>
									Speichern
								</Button>
							</div>
						</div>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
