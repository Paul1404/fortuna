import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AssetValueDialog } from "@/components/asset-value-dialog";
import { Donut } from "@/components/charts/donut";
import { PageHeader } from "@/components/page-header";
import {
	annualisedReturn,
	InlineAddRow,
	SectionHeader,
	SettledGroup,
	SheetRow,
} from "@/components/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { daysBetween, todayIso } from "@/domain/dates";
import { percentChange } from "@/domain/money";
import { splitSettled } from "@/domain/settlement";
import { Money, useFormat } from "@/lib/format";
import {
	amount,
	CURRENCIES,
	optStr,
	reportError,
	str,
	useInvalidateAll,
} from "@/lib/forms";
import { ASSET_CATEGORY_LABELS } from "@/lib/labels";
import { orpc } from "@/lib/orpc";
import { ASSET_CATEGORIES } from "@/lib/schemas";
import { cn } from "@/lib/utils";

// Sheets group categories the way a person thinks about them; sections inside
// a sheet are free text the user chooses (defaults to the category label).
const SHEETS: {
	key: string;
	label: string;
	categories: (typeof ASSET_CATEGORIES)[number][];
}[] = [
	{ key: "all", label: "Alle", categories: [...ASSET_CATEGORIES] },
	{ key: "property", label: "Immobilien", categories: ["real_estate"] },
	{ key: "vehicles", label: "Fahrzeuge", categories: ["vehicle"] },
	{
		key: "collection",
		label: "Uhren & Sammlerstücke",
		categories: ["watch", "collectible", "precious_metal"],
	},
	{
		key: "inventory",
		label: "Verkaufsbestand",
		categories: ["inventory"],
	},
	{
		key: "private",
		label: "Private Beteiligungen",
		categories: ["private_investment", "other"],
	},
];

type Search = { sheet?: string };

export const Route = createFileRoute("/_app/assets/")({
	validateSearch: (raw: Record<string, unknown>): Search => ({
		sheet:
			SHEETS.some((s) => s.key === raw.sheet) && raw.sheet !== "all"
				? String(raw.sheet)
				: undefined,
	}),
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(
				orpc.assets.list.queryOptions({ input: { includeInactive: true } }),
			),
			context.queryClient.ensureQueryData(orpc.netWorth.current.queryOptions()),
		]);
	},
	head: () => ({ meta: [{ title: "Sachwerte · Fortuna" }] }),
	component: AssetsPage,
});

type AssetRow = Awaited<ReturnType<typeof orpc.assets.list.call>>[number];

function AssetsPage() {
	const { sheet = "all" } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const { data: assets } = useSuspenseQuery(
		orpc.assets.list.queryOptions({ input: { includeInactive: true } }),
	);
	const { data: nw } = useSuspenseQuery(orpc.netWorth.current.queryOptions());
	const { data: settings } = useSuspenseQuery(orpc.settings.get.queryOptions());
	const f = useFormat();
	const invalidate = useInvalidateAll();
	const [addingIn, setAddingIn] = useState<string | null>(null);
	const [valuing, setValuing] = useState<string | null>(null);
	const update = useMutation(
		orpc.assets.update.mutationOptions({
			onSuccess: () => invalidate(),
			onError: reportError,
		}),
	);
	const create = useMutation(
		orpc.assets.create.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Sachwert hinzugefügt");
				setAddingIn(null);
			},
			onError: reportError,
		}),
	);

	const current = SHEETS.find((s) => s.key === sheet) ?? SHEETS[0];
	const active = assets.filter((a) => a.isActive);
	const sheetTotals = SHEETS.map((s) => ({
		...s,
		totalMinor: active
			.filter(
				(a) =>
					s.categories.includes(a.category) &&
					a.currency === settings.baseCurrency,
			)
			.reduce((sum, a) => sum + a.currentValueMinor, 0),
	}));
	const { open: visible, settled: disposed } = splitSettled(
		assets.filter((a) => current.categories.includes(a.category)),
	);
	const valuingAsset = assets.find((a) => a.id === valuing) ?? null;
	const sections = new Map<string, AssetRow[]>();
	for (const a of visible) {
		const name = a.section?.trim() || ASSET_CATEGORY_LABELS[a.category];
		sections.set(name, [...(sections.get(name) ?? []), a]);
	}
	const physical = nw.allocation.filter(
		(a) => !["cash", "investments"].includes(a.key),
	);

	return (
		<div className="space-y-5">
			<PageHeader
				title="Sachwerte"
				subtitle="Einen Sachwert antippen, um seinen Wert zu aktualisieren; jede Änderung wird als datierte Bewertung gespeichert"
				actions={
					<>
						<Button onClick={() => setAddingIn("__new")}>
							<Plus /> Sachwert
						</Button>
						<Button variant="outline" asChild>
							<a href="/api/export/assets" download>
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
						onClick={() =>
							navigate({ search: s.key === "all" ? {} : { sheet: s.key } })
						}
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
			<div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
				<div className="space-y-4">
					{sections.size === 0 && addingIn !== "__new" ? (
						<Card>
							<EmptyState
								title="Dieser Bereich ist leer"
								description="Füge wertvollen Besitz hinzu, zum Beispiel eine Wohnung, ein Auto, eine Uhr oder Gold."
								action={
									<Button onClick={() => setAddingIn("__new")}>
										Sachwert hinzufügen
									</Button>
								}
							/>
						</Card>
					) : null}
					{Array.from(sections.entries()).map(([name, rows]) => {
						// Only base-currency rows may be added up; the sheet shows other
						// currencies on the row itself.
						const subtotal = rows
							.filter((r) => r.isActive && r.currency === settings.baseCurrency)
							.reduce((s, r) => s + r.currentValueMinor, 0);
						return (
							<Card key={name} className="overflow-hidden">
								<SectionHeader
									title={name}
									count={rows.length}
									subtotalMinor={subtotal}
									action={
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setAddingIn(name)}
										>
											<Plus /> Hinzufügen
										</Button>
									}
									onRename={(newName) => {
										for (const r of rows)
											update.mutate({ id: r.id, section: newName });
									}}
								/>
								<div>
									{rows.map((a) => (
										<AssetRowButton
											key={a.id}
											asset={a}
											baseCurrency={settings.baseCurrency}
											onOpen={() => setValuing(a.id)}
										/>
									))}
								</div>
								{addingIn === name ? (
									<NewAssetRow
										section={name}
										defaultCategory={rows[0]?.category ?? current.categories[0]}
										defaultCurrency={settings.baseCurrency}
										onCancel={() => setAddingIn(null)}
										onSubmit={(v) => create.mutate(v)}
										pending={create.isPending}
									/>
								) : null}
							</Card>
						);
					})}
					{addingIn === "__new" ? (
						<Card className="overflow-hidden">
							<SectionHeader
								title="Neuer Bereich"
								count={0}
								subtotalMinor={0}
							/>
							<NewAssetRow
								section=""
								defaultCategory={current.categories[0]}
								defaultCurrency={settings.baseCurrency}
								onCancel={() => setAddingIn(null)}
								onSubmit={(v) => create.mutate(v)}
								pending={create.isPending}
								askSection
							/>
						</Card>
					) : null}
					<SettledGroup count={disposed.length} label="Veräußert">
						{disposed.map((a) => (
							<AssetRowButton
								key={a.id}
								asset={a}
								baseCurrency={settings.baseCurrency}
								onOpen={() =>
									navigate({ to: "/assets/$id", params: { id: a.id } })
								}
							/>
						))}
					</SettledGroup>
				</div>
				<Card className="self-start">
					<CardHeader
						title="Sachwerte nach Klasse"
						subtitle={`Sachwerte ${f.money(nw.physicalMinor)}`}
					/>
					<CardBody>
						{physical.length ? (
							<Donut
								slices={physical}
								totalMinor={nw.physicalMinor}
								centerLabel="Sachwerte"
								size={130}
							/>
						) : (
							<p className="text-xs text-text-muted">Keine Daten vorhanden.</p>
						)}
					</CardBody>
				</Card>
			</div>
			{valuingAsset ? (
				<AssetValueDialog
					asset={valuingAsset}
					onClose={() => setValuing(null)}
					showDetailsLink
				/>
			) : null}
		</div>
	);
}

/**
 * One Sachwert in its sheet. The whole row opens the value update: that is
 * the job the row is visited for, and it needs no hover to find.
 */
function AssetRowButton({
	asset: a,
	baseCurrency,
	onOpen,
}: {
	asset: AssetRow;
	baseCurrency: string;
	onOpen: () => void;
}) {
	const f = useFormat();
	const gain =
		a.acquisitionCostMinor !== null
			? a.currentValueMinor - a.acquisitionCostMinor
			: null;
	const pct = a.acquisitionCostMinor
		? percentChange(a.acquisitionCostMinor, a.currentValueMinor)
		: null;
	const pa = annualisedReturn(
		a.acquisitionCostMinor,
		a.currentValueMinor,
		a.acquisitionDate ? daysBetween(a.acquisitionDate, todayIso()) : null,
	);
	return (
		<SheetRow
			title={a.name}
			meta={[
				ASSET_CATEGORY_LABELS[a.category] ?? "—",
				a.currency !== baseCurrency ? a.currency : null,
				a.valuationDate
					? `bewertet ${f.date(a.valuationDate, "short")}`
					: "ohne Bewertung",
				a.acquisitionCostMinor !== null
					? `Kauf ${f.money(a.acquisitionCostMinor, a.currency)}`
					: null,
				pa === null ? null : `${f.percent(pa)} p. a.`,
			]
				.filter(Boolean)
				.join(" · ")}
			badges={
				a.linkedLiabilityName || !a.isActive ? (
					<>
						{a.linkedLiabilityName ? (
							<Badge variant="warning">finanziert</Badge>
						) : null}
						{!a.isActive ? <Badge>veräußert</Badge> : null}
					</>
				) : null
			}
			amount={<Money amountMinor={a.currentValueMinor} currency={a.currency} />}
			amountDetail={
				gain !== null ? (
					<>
						<Money
							amountMinor={gain}
							currency={a.currency}
							tone="auto"
							signed
							weight="medium"
						/>
						{pct === null ? null : ` ${f.percent(pct)}`}
					</>
				) : undefined
			}
			muted={!a.isActive}
			onOpen={onOpen}
			label={`${a.name}: ${f.money(a.currentValueMinor, a.currency)}. Wert aktualisieren`}
		/>
	);
}

function NewAssetRow({
	section,
	defaultCategory,
	defaultCurrency,
	onCancel,
	onSubmit,
	pending,
	askSection,
}: {
	section: string;
	defaultCategory: (typeof ASSET_CATEGORIES)[number];
	defaultCurrency: string;
	onCancel: () => void;
	onSubmit: (v: Parameters<typeof orpc.assets.create.call>[0]) => void;
	pending: boolean;
	askSection?: boolean;
}) {
	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				const form = new FormData(e.currentTarget);
				const value = amount(form, "value");
				if (value === null) return toast.error("Wert eingeben");
				onSubmit({
					name: str(form, "name"),
					category: str(form, "category") as (typeof ASSET_CATEGORIES)[number],
					currency: str(form, "currency"),
					currentValueMinor: value,
					valuationDate: todayIso(),
					acquisitionCostMinor: amount(form, "cost"),
					acquisitionDate: optStr(form, "acquired"),
					section: askSection ? optStr(form, "section") : section || null,
				});
			}}
		>
			<InlineAddRow>
				{askSection ? (
					<Field label="Bereich" htmlFor="na-section">
						<Input
							id="na-section"
							name="section"
							placeholder="z. B. Uhren"
							className="w-36"
						/>
					</Field>
				) : null}
				<Field
					label="Name"
					htmlFor="na-name"
					className="min-w-0 flex-1 sm:min-w-[200px]"
				>
					<Input
						id="na-name"
						name="name"
						required
						autoFocus
						placeholder="z. B. Rolex Submariner 126610LN"
					/>
				</Field>
				<Field label="Kategorie" htmlFor="na-cat">
					<NativeSelect
						id="na-cat"
						name="category"
						defaultValue={defaultCategory}
						className="w-40"
					>
						{ASSET_CATEGORIES.map((c) => (
							<option key={c} value={c}>
								{ASSET_CATEGORY_LABELS[c]}
							</option>
						))}
					</NativeSelect>
				</Field>
				<Field label="Wert" htmlFor="na-value">
					<Input
						id="na-value"
						name="value"
						inputMode="decimal"
						required
						className="amount w-28"
					/>
				</Field>
				<Field label="Währung" htmlFor="na-cur">
					<NativeSelect
						id="na-cur"
						name="currency"
						defaultValue={defaultCurrency}
						className="w-20"
					>
						{CURRENCIES.map((c) => (
							<option key={c}>{c}</option>
						))}
					</NativeSelect>
				</Field>
				<Field label="Kaufpreis" htmlFor="na-cost">
					<Input
						id="na-cost"
						name="cost"
						inputMode="decimal"
						className="amount w-28"
					/>
				</Field>
				<Field label="Gekauft am" htmlFor="na-acq">
					<Input
						id="na-acq"
						name="acquired"
						type="date"
						className="w-[10.5rem]"
					/>
				</Field>
				<div className="flex gap-1 pb-0.5">
					<Button type="submit" size="sm" disabled={pending}>
						Hinzufügen
					</Button>
					<Button type="button" size="sm" variant="ghost" onClick={onCancel}>
						Abbrechen
					</Button>
				</div>
			</InlineAddRow>
		</form>
	);
}
