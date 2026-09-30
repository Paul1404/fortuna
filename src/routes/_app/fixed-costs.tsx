import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { FileText, Link2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	CONTRACT_CATEGORY_LABELS,
	CONTRACT_FREQUENCY_LABELS,
	ContractDialog,
	type ContractPreset,
	type ContractRow,
	DOCUMENT_LABELS,
	DocumentUpload,
} from "@/components/fixed-costs/contract-dialog";
import { MissionDateDialog } from "@/components/fixed-costs/mission-date-dialog";
import {
	MissionDialog,
	type MissionPreset,
	type MissionRow,
} from "@/components/fixed-costs/mission-dialog";
import {
	RecurringDialog,
	type RecurringRow,
} from "@/components/fixed-costs/recurring-dialog";
import { PageHeader } from "@/components/page-header";
import { StatRow, StatTile } from "@/components/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { type FixedCostItem, groupFixedCosts } from "@/domain/fixed-costs";
import {
	optimizationCategoryForTitle,
	switchableCost,
} from "@/domain/optimization";
import { Money, useFormat } from "@/lib/format";
import { reportError, useInvalidateAll } from "@/lib/forms";
import { FREQUENCY_LABELS } from "@/lib/labels";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";

/**
 * Fixkosten: recurring payments and contracts as one list, with the
 * Sparmission as a status on the item it would replace. It replaces the
 * former Wiederkehrend, Verträge and Optimierung pages; the tables and the
 * phase logic (`src/domain/contract.ts`, `src/domain/optimization.ts`) are
 * unchanged.
 */

type Search = {
	item?: string;
	highlight?: string;
	contract?: string;
	mission?: string;
};

export const Route = createFileRoute("/_app/fixed-costs")({
	validateSearch: (raw: Record<string, unknown>): Search => ({
		item: typeof raw.item === "string" ? raw.item : undefined,
		highlight: typeof raw.highlight === "string" ? raw.highlight : undefined,
		contract: typeof raw.contract === "string" ? raw.contract : undefined,
		mission: typeof raw.mission === "string" ? raw.mission : undefined,
	}),
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(
				orpc.recurring.list.queryOptions({ input: { includeInactive: true } }),
			),
			context.queryClient.ensureQueryData(orpc.contracts.list.queryOptions()),
			context.queryClient.ensureQueryData(
				orpc.optimizations.list.queryOptions(),
			),
			context.queryClient.ensureQueryData(orpc.categories.list.queryOptions()),
			context.queryClient.ensureQueryData(
				orpc.accounts.list.queryOptions({ input: {} }),
			),
			context.queryClient.ensureQueryData(orpc.settings.get.queryOptions()),
		]);
	},
	head: () => ({ meta: [{ title: "Fixkosten · Fortuna" }] }),
	component: FixedCostsPage,
});

type Item = FixedCostItem<RecurringRow, ContractRow, MissionRow>;

type EditState =
	| { kind: "recurring"; row: RecurringRow | null }
	| { kind: "contract"; value: ContractRow | null; preset?: ContractPreset }
	| {
			kind: "mission";
			row: MissionRow | null;
			candidate: MissionPreset | null;
			completing?: boolean;
	  }
	| { kind: "mission-date"; mission: MissionRow };

function FixedCostsPage() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const { data: recurring } = useSuspenseQuery(
		orpc.recurring.list.queryOptions({ input: { includeInactive: true } }),
	);
	const { data: contracts } = useSuspenseQuery(
		orpc.contracts.list.queryOptions(),
	);
	const { data: missions } = useSuspenseQuery(
		orpc.optimizations.list.queryOptions(),
	);
	const { data: categories } = useSuspenseQuery(
		orpc.categories.list.queryOptions(),
	);
	const { data: accounts } = useSuspenseQuery(
		orpc.accounts.list.queryOptions({ input: {} }),
	);
	const { data: settings } = useSuspenseQuery(orpc.settings.get.queryOptions());
	const f = useFormat();
	const invalidate = useInvalidateAll();
	const [edit, setEdit] = useState<EditState | null>(null);
	const detect = useMutation(
		orpc.recurring.detect.mutationOptions({
			onSuccess: async (r) => {
				await invalidate();
				toast.success(
					`${r.created} neu, ${r.updated} aktualisiert (${r.candidates} Muster gefunden)`,
				);
			},
			onError: reportError,
		}),
	);

	const items = groupFixedCosts(recurring, contracts, missions);
	const outflows = items.filter((item) => item.direction === "outflow");
	const inflows = items.filter((item) => item.direction === "inflow");
	const running = outflows.filter((item) => item.active);
	const ended = outflows.filter((item) => !item.active);
	const base = settings.baseCurrency;
	// Totals stay in the base currency; items in another currency, and those
	// whose cost cannot be turned into a month, are counted rather than summed.
	const counted = running.filter(
		(item) => item.counted && item.currency === base,
	);
	const monthly = counted.reduce(
		(sum, item) => sum + Math.abs(item.monthlyMinor ?? 0),
		0,
	);
	// Paid through the salary: listed, but no cost of the account.
	const viaPayroll = running.filter((item) => item.viaPayroll).length;
	const uncounted = running.filter(
		(item) =>
			(item.recurring || item.contract) &&
			!item.viaPayroll &&
			!counted.includes(item),
	).length;
	const subscriptions = counted
		.filter((item) => item.recurring?.isSubscription)
		.reduce((sum, item) => sum + Math.abs(item.monthlyMinor ?? 0), 0);
	const overdue = running.filter(
		(item) => item.recurring?.overdue && !item.viaPayroll,
	).length;
	const missionsInBase = missions.filter(
		(mission) => mission.currency === base,
	);
	const realized = missionsInBase.reduce(
		(sum, mission) => sum + mission.progress.realizedMinor,
		0,
	);
	// Only what actually stays in the account counts as running: a mission
	// waiting for its old contract, or without a date, keeps nothing yet.
	const savingMonthly = missionsInBase
		.filter((mission) =>
			["saving", "earning_back"].includes(mission.progress.phase),
		)
		.reduce(
			(sum, mission) => sum + Math.max(0, mission.monthlySavingsMinor),
			0,
		);
	const openMissions = missions.filter((mission) =>
		["idea", "planned"].includes(mission.status),
	);
	// Missing a notice deadline is the one thing here that costs real money.
	const deadlines = contracts
		.filter(
			(row) =>
				row.phase !== "ended" &&
				row.noticeDeadline &&
				row.noticeDeadline.daysLeft <= 60,
		)
		.sort(
			(left, right) =>
				(left.noticeDeadline?.daysLeft ?? 0) -
				(right.noticeDeadline?.daysLeft ?? 0),
		);

	const selectedKey =
		search.item ??
		(search.highlight
			? items.find((item) => item.recurring?.id === search.highlight)?.key
			: undefined) ??
		(search.contract
			? items.find((item) => item.contract?.id === search.contract)?.key
			: undefined) ??
		(search.mission
			? items.find((item) =>
					item.missions.some((mission) => mission.id === search.mission),
				)?.key
			: undefined);
	const selected = items.find((item) => item.key === selectedKey) ?? null;
	const openItem = (key: string | undefined) =>
		navigate({ search: key ? { item: key } : {}, replace: !key });

	return (
		<div className="space-y-5">
			<PageHeader
				title="Fixkosten"
				subtitle="Was regelmäßig abgeht: Zahlung, Vertrag und Sparmission als ein Posten"
				actions={
					<>
						<Button
							variant="outline"
							onClick={() => detect.mutate(undefined)}
							disabled={detect.isPending}
						>
							<RefreshCw className={cn(detect.isPending && "animate-spin")} />{" "}
							Erkennen
						</Button>
						<Button
							variant="outline"
							onClick={() => setEdit({ kind: "contract", value: null })}
						>
							<Plus /> Vertrag
						</Button>
						<Button onClick={() => setEdit({ kind: "recurring", row: null })}>
							<Plus /> Zahlung
						</Button>
					</>
				}
			/>
			<StatRow className="xl:grid-cols-4">
				<StatTile
					label="Im Monat"
					value={<Money amountMinor={monthly} className="text-[22px]" />}
					detail={
						<span className="text-text-muted">
							{counted.length} Posten
							{uncounted > 0 ? ` · ${uncounted} ohne Monatswert` : ""}
							{viaPayroll > 0 ? ` · ${viaPayroll} über Gehalt` : ""}
						</span>
					}
				/>
				<StatTile
					label="Davon Abos"
					value={<Money amountMinor={subscriptions} className="text-[22px]" />}
					detail={
						<span className="text-text-muted">
							{f.money(subscriptions * 12)} im Jahr
						</span>
					}
				/>
				<StatTile
					label="Überfällig"
					value={String(overdue)}
					detail={
						<span className="text-text-muted">
							erwartet, aber nicht abgebucht
						</span>
					}
				/>
				<StatTile
					label="Bereits gespart"
					value={<Money amountMinor={realized} className="text-[22px]" />}
					detail={
						<span className="text-text-muted">
							{savingMonthly > 0
								? `${f.money(savingMonthly)} im Monat laufend`
								: `${openMissions.length} ${openMissions.length === 1 ? "Sparidee" : "Sparideen"} offen`}
						</span>
					}
				/>
			</StatRow>

			{deadlines.length ? (
				<Card>
					<CardHeader
						title="Kündigungsfristen"
						subtitle="Wer hier zu spät ist, zahlt eine weitere Laufzeit."
					/>
					<CardBody className="space-y-2">
						{deadlines.map((row) => {
							const deadline = row.noticeDeadline;
							if (!deadline) return null;
							const missed = deadline.daysLeft < 0;
							return (
								<p
									key={row.id}
									className={cn(
										"text-sm",
										missed
											? "text-text-secondary"
											: deadline.daysLeft <= 14
												? "text-negative"
												: "text-warning",
									)}
								>
									<strong>{row.name}</strong>{" "}
									{missed
										? `— Frist am ${f.date(deadline.date)} verstrichen, der Vertrag verlängert sich zum ${f.date(deadline.renewsOn)}.`
										: `— noch ${deadline.daysLeft} ${deadline.daysLeft === 1 ? "Tag" : "Tage"} Zeit zu kündigen (bis ${f.date(deadline.date)}), sonst läuft er ab ${f.date(deadline.renewsOn)} weiter.`}
								</p>
							);
						})}
					</CardBody>
				</Card>
			) : null}

			<Card>
				<CardHeader
					title="Laufende Fixkosten"
					subtitle="Zum Öffnen eine Zeile anklicken. Die Erkennung überschreibt weder Namen noch Kategorie oder Abo-Markierung."
				/>
				{running.length === 0 ? (
					<EmptyState
						title="Noch nichts erfasst"
						description="Importieren Sie mindestens drei Monate an Buchungen und starten Sie die Erkennung, oder legen Sie eine Zahlung oder einen Vertrag an."
						action={
							<Button onClick={() => detect.mutate(undefined)}>
								Erkennung starten
							</Button>
						}
					/>
				) : (
					<ItemTable items={running} onOpen={openItem} onEdit={setEdit} />
				)}
			</Card>

			{inflows.length ? (
				<Card>
					<CardHeader
						title="Regelmäßige Einnahmen"
						subtitle="Gehalt, Erstattungen und andere wiederkehrende Eingänge"
					/>
					<ItemTable items={inflows} onOpen={openItem} onEdit={setEdit} />
				</Card>
			) : null}

			{ended.length ? (
				<details className="surface overflow-hidden">
					<summary className="cursor-pointer px-4 py-3 text-sm text-text-secondary">
						Beendet und inaktiv ({ended.length})
					</summary>
					<ItemTable items={ended} onOpen={openItem} onEdit={setEdit} />
				</details>
			) : null}

			<div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
				<button
					type="button"
					className="text-brand hover:underline"
					onClick={() =>
						setEdit({ kind: "mission", row: null, candidate: null })
					}
				>
					Sparidee ohne Zahlung anlegen
				</button>
				<span aria-hidden>·</span>
				<a
					href="/api/export/optimizations"
					download
					className="text-brand hover:underline"
				>
					Sparmissionen als CSV
				</a>
			</div>

			{selected && !edit ? (
				<ItemDialog
					item={selected}
					onClose={() => openItem(undefined)}
					onEdit={setEdit}
				/>
			) : null}
			{edit?.kind === "mission-date" ? (
				<MissionDateDialog
					mission={edit.mission}
					contract={
						contracts.find((row) => row.id === edit.mission.contractId) ?? null
					}
					onClose={() => setEdit(null)}
				/>
			) : null}
			{edit?.kind === "recurring" ? (
				<RecurringDialog
					row={edit.row}
					onClose={() => setEdit(null)}
					categories={categories}
					accounts={accounts}
					defaultCurrency={base}
				/>
			) : null}
			{edit?.kind === "contract" ? (
				<ContractDialog
					value={edit.value}
					preset={edit.preset}
					accounts={accounts}
					recurring={recurring.filter((row) => row.isActive)}
					defaultCurrency={base}
					onClose={() => setEdit(null)}
				/>
			) : null}
			{edit?.kind === "mission" ? (
				<MissionDialog
					key={edit.row?.id ?? edit.candidate?.title ?? "new"}
					row={edit.row}
					candidate={edit.candidate}
					completing={edit.completing}
					accounts={accounts}
					contracts={contracts}
					defaultCurrency={base}
					onClose={() => setEdit(null)}
				/>
			) : null}
		</div>
	);
}

function ItemTable({
	items,
	onOpen,
	onEdit,
}: {
	items: Item[];
	onOpen: (key: string) => void;
	onEdit: (edit: EditState) => void;
}) {
	const f = useFormat();
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Posten</TableHead>
					<TableHead className="hidden md:table-cell">Turnus</TableHead>
					<TableHead className="hidden sm:table-cell">Nächste</TableHead>
					<TableHead className="text-right">Im Monat</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{items.map((item) => {
					const payment = item.recurring;
					const contract = item.contract;
					const frequency = payment?.frequency ?? contract?.frequency ?? null;
					return (
						<TableRow
							key={item.key}
							className={cn("cursor-pointer", !item.active && "opacity-60")}
							onActivate={() => onOpen(item.key)}
						>
							<TableCell className="min-w-[14rem] max-sm:[&>span]:text-left">
								<span className="break-words text-text">{item.name}</span>
								<span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
									{payment?.isSubscription ? (
										<Badge variant="brand">Abo</Badge>
									) : null}
									{contract ? <Badge>Vertrag</Badge> : null}
									{item.viaPayroll ? <Badge>über Gehalt</Badge> : null}
									{payment?.overdue && !item.viaPayroll ? (
										<Badge variant="warning">überfällig</Badge>
									) : null}
									<MissionBadge item={item} />
								</span>
								<ItemSubline item={item} />
								{payment?.nextExpected && item.active ? (
									<span className="mt-0.5 block text-[11px] text-text-muted sm:hidden">
										nächste {f.date(payment.nextExpected, "short")}
									</span>
								) : null}
								{item.divergence ? (
									<span className="mt-0.5 block text-[11px] text-warning">
										Abgebucht{" "}
										{f.money(item.divergence.bookedMinor, item.currency)} im
										Monat, laut Vertrag{" "}
										{f.money(item.divergence.agreedMinor, item.currency)}
									</span>
								) : null}
								{payment?.unlinked && !item.viaPayroll ? (
									<UnlinkedHint payment={payment} />
								) : null}
								{item.mission && isUndated(item.mission) ? (
									// The badge above already says "Datum fehlt".
									<span className="mt-1 flex">
										<RowAction
											onClick={() =>
												item.mission &&
												onEdit({ kind: "mission-date", mission: item.mission })
											}
										>
											Datum eintragen
										</RowAction>
									</span>
								) : null}
							</TableCell>
							<TableCell className="hidden text-text-secondary md:table-cell">
								{frequency ? (FREQUENCY_LABELS[frequency] ?? "—") : "—"}
							</TableCell>
							<TableCell className="hidden font-mono text-xs sm:table-cell">
								{payment?.nextExpected && item.active
									? f.date(payment.nextExpected, "short")
									: "—"}
							</TableCell>
							<TableCell className="text-right">
								{item.monthlyMinor === null ? (
									<span className="text-text-muted">—</span>
								) : (
									<Money
										amountMinor={item.monthlyMinor}
										currency={item.currency}
										tone={item.monthlyMinor > 0 ? "positive" : "default"}
										className={cn(item.viaPayroll && "text-text-muted")}
									/>
								)}
								{item.viaPayroll && item.monthlyMinor !== null ? (
									<span className="block text-[11px] text-text-muted">
										nicht vom Konto
									</span>
								) : !payment && contract && item.monthlyMinor !== null ? (
									<span className="block text-[11px] text-text-muted">
										laut Vertrag
									</span>
								) : null}
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
}

function ItemSubline({ item }: { item: Item }) {
	const f = useFormat();
	const contract = item.contract;
	const parts = [
		contract?.provider,
		item.recurring?.accountName ?? contract?.accountName,
		contract ? contractPhaseText(contract, f) : null,
		!item.recurring && !item.contract ? "Sparidee ohne Zahlung" : null,
	].filter(Boolean);
	return parts.length ? (
		<span className="mt-0.5 block break-words text-[11px] text-text-muted">
			{parts.join(" · ")}
		</span>
	) : null;
}

type Format = ReturnType<typeof useFormat>;

function contractPhaseText(contract: ContractRow, f: Format): string {
	if (contract.phase === "cancelled_running")
		return contract.costsUntil
			? `gekündigt, läuft bis ${f.date(contract.costsUntil)}`
			: "gekündigt, Enddatum fehlt";
	if (contract.phase === "ended")
		return contract.endDate
			? `beendet am ${f.date(contract.endDate)}`
			: "beendet";
	return contract.renewalDate
		? `verlängert sich am ${f.date(contract.renewalDate)}`
		: contract.endDate
			? `läuft bis ${f.date(contract.endDate)}`
			: "unbefristet";
}

/**
 * A Sparmission's status in the words of what it means for the account.
 * Nothing counts as saved before the old cost has stopped: a mission waiting
 * for that day says "ab <Datum>", one without a date says so.
 */
function missionStatus(
	mission: MissionRow,
	f: Format,
): {
	label: string;
	variant: "default" | "brand" | "positive" | "warning";
	sentence: string | null;
} {
	const progress = mission.progress;
	const monthly = f.money(
		Math.max(0, mission.monthlySavingsMinor),
		mission.currency,
	);
	if (mission.status === "idea")
		return { label: "Sparidee", variant: "default", sentence: null };
	if (mission.status === "planned")
		return { label: "Wechsel geplant", variant: "brand", sentence: null };
	if (mission.status === "dismissed")
		return { label: "verworfen", variant: "default", sentence: null };
	switch (progress.phase) {
		case "undated":
			return {
				label: "Datum fehlt",
				variant: "warning",
				sentence:
					progress.missing === "contract_end"
						? "Der alte Vertrag hat noch kein Enddatum. Erst danach zählt die Ersparnis."
						: "Noch kein Datum, ab dem die alten Kosten wegfallen. Bis dahin zählt nichts als gespart.",
			};
		case "waiting":
			return {
				label: `spart ab ${f.date(progress.savingFrom ?? "", "short")}`,
				variant: "warning",
				sentence: `Ab ${f.date(progress.savingFrom ?? "")} fallen ${monthly} im Monat weg${
					progress.daysUntilSaving !== null
						? ` (noch ${progress.daysUntilSaving} ${progress.daysUntilSaving === 1 ? "Tag" : "Tage"})`
						: ""
				}. Bis dahin läuft der alte Preis.`,
			};
		case "earning_back":
			return {
				label: "Wechselkosten offen",
				variant: "warning",
				sentence: `Wechselkosten: noch ${f.money(progress.outstandingCostMinor, mission.currency)} offen${
					progress.paybackOn
						? `, ab ${f.date(progress.paybackOn)} ist es echtes Plus`
						: ""
				}.`,
			};
		case "saving":
			return {
				label: `spart ${monthly}`,
				variant: "positive",
				sentence: `Seit ${f.date(progress.savingFrom ?? "")} ${f.money(progress.realizedMinor, mission.currency)} gespart.`,
			};
		case "no_saving":
			return {
				label: "keine Ersparnis",
				variant: "default",
				sentence:
					mission.monthlySavingsMinor < 0
						? `Die Alternative kostet ${f.money(-mission.monthlySavingsMinor, mission.currency)} im Monat mehr.`
						: "Die Alternative kostet gleich viel.",
			};
		default:
			return { label: "—", variant: "default", sentence: null };
	}
}

/** A completed mission that cannot count anything until a date is known. */
function isUndated(mission: MissionRow): boolean {
	return mission.status === "completed" && mission.progress.phase === "undated";
}

/**
 * A one-tap fix inside a clickable row: large enough for a thumb, and it
 * does its own job rather than opening the row.
 */
function RowAction({
	children,
	disabled,
	onClick,
}: {
	children: React.ReactNode;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={(event) => {
				event.stopPropagation();
				onClick();
			}}
			onKeyDown={(event) => event.stopPropagation()}
			className="inline-flex min-h-9 items-center gap-1 rounded-control border border-brand/40 bg-surface px-2.5 text-xs font-medium text-brand hover:border-brand hover:bg-brand-subtle disabled:opacity-60 sm:min-h-7"
		>
			{children}
		</button>
	);
}

function MissionBadge({ item }: { item: Item }) {
	const f = useFormat();
	if (!item.mission) return null;
	const status = missionStatus(item.mission, f);
	return <Badge variant={status.variant}>{status.label}</Badge>;
}

/** A payment with no booking linked while its category has bookings. */
function UnlinkedHint({ payment }: { payment: RecurringRow }) {
	const invalidate = useInvalidateAll();
	const link = useMutation(
		orpc.recurring.linkMatches.mutationOptions({
			onSuccess: async (result) => {
				await invalidate();
				toast.success(
					result.linked === 1
						? "1 Buchung verknüpft"
						: `${result.linked} Buchungen verknüpft`,
				);
			},
			onError: reportError,
		}),
	);
	const unlinked = payment.unlinked;
	if (!unlinked) return null;
	return (
		<span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-warning">
			keine Buchung verknüpft
			{unlinked.matches > 0 ? (
				<RowAction
					disabled={link.isPending}
					onClick={() => link.mutate({ id: payment.id })}
				>
					<Link2 className="size-3.5" />
					{link.isPending
						? "Wird verknüpft …"
						: unlinked.matches === 1
							? "1 passende verknüpfen"
							: `${unlinked.matches} passende verknüpfen`}
				</RowAction>
			) : payment.categoryId ? (
				<Link
					to="/transactions"
					search={{ categoryId: payment.categoryId }}
					onClick={(event) => event.stopPropagation()}
					className="text-brand hover:underline"
				>
					{unlinked.categoryBookings} in der Kategorie ansehen
				</Link>
			) : null}
		</span>
	);
}

function ItemDialog({
	item,
	onClose,
	onEdit,
}: {
	item: Item;
	onClose: () => void;
	onEdit: (edit: EditState) => void;
}) {
	const f = useFormat();
	const invalidate = useInvalidateAll();
	const payment = item.recurring;
	const contract = item.contract;
	const mission = item.mission;
	const removeContract = useMutation(
		orpc.contracts.remove.mutationOptions({
			onSuccess: async (result) => {
				await invalidate();
				toast.success(
					result.documentsDeleted
						? `Vertrag gelöscht, ${result.documentsDeleted} ${result.documentsDeleted === 1 ? "Datei" : "Dateien"} entfernt`
						: "Vertrag gelöscht",
				);
			},
			onError: reportError,
		}),
	);
	const applyProposal = useMutation(
		orpc.contracts.update.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Aus den Buchungen übernommen");
			},
			onError: reportError,
		}),
	);
	const planMission = useMutation(
		orpc.optimizations.update.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Sparmission geplant");
			},
			onError: reportError,
		}),
	);
	const monthlyCost = Math.abs(item.monthlyMinor ?? 0);
	const missionPreset: MissionPreset = {
		title: `${item.name} günstiger`,
		currentMonthlyMinor: monthlyCost,
		currency: item.currency,
		category: optimizationCategoryForTitle(item.name),
		recurringPaymentId: payment?.id ?? null,
		contractId: contract?.id ?? null,
	};
	const offerMission =
		!mission &&
		item.direction === "outflow" &&
		item.active &&
		switchableCost(item.name, payment?.categorySlug ?? null);
	const status = mission ? missionStatus(mission, f) : null;

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				title={item.name}
				description={
					[
						contract?.provider,
						contract ? CONTRACT_CATEGORY_LABELS[contract.category] : null,
					]
						.filter(Boolean)
						.join(" · ") || undefined
				}
				className="max-w-2xl"
			>
				<section className="space-y-2">
					<h3 className="label-caps">Zahlung</h3>
					{payment ? (
						<>
							<dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
								<Fact label="Betrag">
									<Money
										amountMinor={payment.expectedAmountMinor}
										currency={payment.currency}
										tone={
											payment.direction === "inflow" ? "positive" : "default"
										}
									/>
								</Fact>
								<Fact label="Turnus">
									{FREQUENCY_LABELS[payment.frequency] ?? "—"}
								</Fact>
								<Fact label="Nächste">
									{payment.nextExpected ? f.date(payment.nextExpected) : "—"}
								</Fact>
								<Fact label="Buchungen">
									<Link
										to="/transactions"
										search={{ recurringPaymentId: payment.id }}
										className="text-brand hover:underline"
									>
										{payment.occurrenceCount}×
									</Link>
								</Fact>
							</dl>
							<p className="text-xs text-text-muted">
								{[payment.accountName, payment.categoryName]
									.filter(Boolean)
									.join(" · ") || "Kein Konto und keine Kategorie"}
								{payment.detectedAutomatically ? " · automatisch erkannt" : ""}
								{!payment.isActive ? " · inaktiv" : ""}
							</p>
							{item.viaPayroll ? null : <UnlinkedHint payment={payment} />}
							<Button
								size="sm"
								variant="outline"
								onClick={() => onEdit({ kind: "recurring", row: payment })}
							>
								Zahlung bearbeiten
							</Button>
						</>
					) : item.viaPayroll ? (
						<p className="text-sm text-text-secondary">
							Wird über das Gehalt bezahlt (Entgeltumwandlung). Vom Konto geht
							dafür nichts ab, deshalb zählt er nicht zu den monatlichen
							Fixkosten.
						</p>
					) : (
						<p className="text-sm text-text-secondary">
							Keine wiederkehrende Zahlung verknüpft.
							{contract ? " Im Vertrag lässt sie sich verknüpfen." : ""}
						</p>
					)}
				</section>

				{item.divergence ? (
					<p className="rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning">
						Abgebucht werden{" "}
						{f.money(item.divergence.bookedMinor, item.currency)} im Monat, laut
						Vertrag {f.money(item.divergence.agreedMinor, item.currency)}. Meist
						ist das eine Preiserhöhung.
					</p>
				) : null}

				<section className="space-y-2 border-t border-border pt-4">
					<h3 className="label-caps">Vertrag</h3>
					{contract ? (
						<ContractFacts
							contract={contract}
							onEdit={() => onEdit({ kind: "contract", value: contract })}
							onApply={() =>
								contract.proposal &&
								applyProposal.mutate({ id: contract.id, ...contract.proposal })
							}
							applying={applyProposal.isPending}
							onRemove={() => {
								if (
									confirm(
										contract.documents.length
											? `„${contract.name}" endgültig löschen? ${contract.documents.length} hinterlegte ${contract.documents.length === 1 ? "Datei wird" : "Dateien werden"} dabei mitgelöscht.`
											: `„${contract.name}" endgültig löschen?`,
									)
								)
									removeContract.mutate({ id: contract.id });
							}}
							removing={removeContract.isPending}
						/>
					) : (
						<div className="flex flex-wrap items-center gap-3">
							<p className="text-sm text-text-secondary">
								Kein Vertrag hinterlegt.
							</p>
							{item.direction === "outflow" ? (
								<Button
									size="sm"
									variant="outline"
									onClick={() =>
										onEdit({
											kind: "contract",
											value: null,
											preset: {
												name: item.name,
												costMinor: payment
													? Math.abs(payment.expectedAmountMinor)
													: null,
												frequency: payment?.frequency ?? "monthly",
												accountId: payment?.accountId ?? null,
												recurringPaymentId: payment?.id ?? null,
											},
										})
									}
								>
									<Plus /> Vertrag anlegen
								</Button>
							) : null}
						</div>
					)}
				</section>

				{mission || offerMission || item.missions.length ? (
					<section className="space-y-2 border-t border-border pt-4">
						<h3 className="label-caps">Sparmission</h3>
						{mission && status ? (
							<div className="space-y-2">
								<p className="flex flex-wrap items-center gap-2 text-sm">
									<span className="break-words text-text">{mission.title}</span>
									<Badge variant={status.variant}>{status.label}</Badge>
								</p>
								<dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
									<Fact label="Heute">
										{f.money(mission.currentMonthlyMinor, mission.currency)}
									</Fact>
									<Fact label="Alternative">
										{f.money(mission.alternativeMonthlyMinor, mission.currency)}
									</Fact>
									<Fact label="Im Monat">
										<Money
											amountMinor={mission.monthlySavingsMinor}
											currency={mission.currency}
											tone="auto"
											signed
										/>
									</Fact>
									<Fact label="1. Jahr">
										<Money
											amountMinor={mission.firstYearSavingsMinor}
											currency={mission.currency}
											tone="auto"
											signed
										/>
									</Fact>
								</dl>
								{status.sentence ? (
									<p className="text-xs text-text-secondary">
										{status.sentence}
									</p>
								) : null}
								<div className="flex flex-wrap gap-2">
									<Button
										size="sm"
										variant="outline"
										onClick={() =>
											onEdit({ kind: "mission", row: mission, candidate: null })
										}
									>
										Bearbeiten
									</Button>
									{isUndated(mission) ? (
										<Button
											size="sm"
											onClick={() => onEdit({ kind: "mission-date", mission })}
										>
											{mission.progress.missing === "contract_end"
												? "Vertragsende eintragen"
												: "Datum eintragen"}
										</Button>
									) : null}
									{mission.status === "idea" ? (
										<Button
											size="sm"
											variant="outline"
											disabled={planMission.isPending}
											onClick={() =>
												planMission.mutate({
													id: mission.id,
													status: "planned",
												})
											}
										>
											Planen
										</Button>
									) : null}
									{mission.status === "idea" || mission.status === "planned" ? (
										<Button
											size="sm"
											onClick={() =>
												onEdit({
													kind: "mission",
													row: mission,
													candidate: null,
													completing: true,
												})
											}
										>
											Umgesetzt
										</Button>
									) : null}
								</div>
							</div>
						) : offerMission ? (
							<div className="flex flex-wrap items-center gap-3">
								<p className="text-sm text-text-secondary">
									Gibt es das günstiger?
								</p>
								<Button
									size="sm"
									variant="outline"
									onClick={() =>
										onEdit({
											kind: "mission",
											row: null,
											candidate: missionPreset,
										})
									}
								>
									<Plus /> Sparmission anlegen
								</Button>
							</div>
						) : null}
						{item.missions
							.filter((other) => other.id !== mission?.id)
							.map((other) => (
								<p key={other.id} className="text-xs text-text-muted">
									{other.title} · {missionStatus(other, f).label}{" "}
									<button
										type="button"
										className="text-brand hover:underline"
										onClick={() =>
											onEdit({ kind: "mission", row: other, candidate: null })
										}
									>
										öffnen
									</button>
								</p>
							))}
					</section>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function ContractFacts({
	contract,
	onEdit,
	onApply,
	applying,
	onRemove,
	removing,
}: {
	contract: ContractRow;
	onEdit: () => void;
	onApply: () => void;
	applying: boolean;
	onRemove: () => void;
	removing: boolean;
}) {
	const f = useFormat();
	return (
		<div className="space-y-3">
			<dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
				<Fact label="Kosten laut Vertrag">
					{contract.costMinor !== null
						? f.money(contract.costMinor, contract.currency)
						: "—"}
					{contract.frequency
						? ` · ${CONTRACT_FREQUENCY_LABELS[contract.frequency] ?? "—"}`
						: ""}
				</Fact>
				<Fact label="Laufzeit">{contractPhaseText(contract, f)}</Fact>
				<Fact label="Vertragsnummer">{contract.contractNumber ?? "—"}</Fact>
			</dl>
			{contract.proposal ? (
				<div className="space-y-1">
					<p className="text-[11px] text-warning">
						Fehlt für die Prognose. Laut Buchungen:{" "}
						{[
							contract.proposal.startDate
								? `Beginn ${f.date(contract.proposal.startDate)}`
								: null,
							contract.proposal.costMinor
								? f.money(contract.proposal.costMinor, contract.currency)
								: null,
							contract.proposal.frequency
								? CONTRACT_FREQUENCY_LABELS[contract.proposal.frequency]
								: null,
						]
							.filter(Boolean)
							.join(" · ")}
						.
					</p>
					<Button
						size="sm"
						variant="outline"
						disabled={applying}
						onClick={onApply}
					>
						Übernehmen
					</Button>
				</div>
			) : null}
			<div>
				<div className="flex items-center justify-between text-xs">
					<span className="text-text-secondary">Dokumentation</span>
					<strong>{contract.completeness}%</strong>
				</div>
				<div className="mt-1 h-2 overflow-hidden rounded bg-chart-neutral-1">
					<div
						className="h-full bg-brand"
						style={{ width: `${contract.completeness}%` }}
					/>
				</div>
				{contract.missingFields.length ? (
					<p className="mt-1 text-[11px] text-warning">
						Fehlt: {contract.missingFields.join(", ")}
					</p>
				) : null}
			</div>
			{contract.documents.length ? (
				<div className="flex flex-wrap gap-2">
					{contract.documents.map((document) => (
						<a
							key={document.id}
							href={`/api/contracts/documents/${document.id}`}
							className="inline-flex min-h-11 max-w-full min-w-0 items-center gap-1 rounded border border-border px-2 py-1 text-xs text-brand hover:bg-surface-sunken sm:min-h-0"
						>
							<FileText className="size-3.5 shrink-0" />
							<span className="min-w-0 break-words">
								{DOCUMENT_LABELS[document.type] ?? "—"} · {document.fileName}
							</span>
						</a>
					))}
				</div>
			) : null}
			<DocumentUpload
				contractId={contract.id}
				defaultType={contract.category === "insurance" ? "policy" : "contract"}
			/>
			<div className="flex flex-wrap gap-2">
				<Button size="sm" variant="outline" onClick={onEdit}>
					Vertrag bearbeiten
				</Button>
				<Button
					size="sm"
					variant="ghost"
					className="text-text-muted"
					disabled={removing}
					onClick={onRemove}
				>
					<Trash2 /> Löschen
				</Button>
			</div>
		</div>
	);
}

function Fact({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="min-w-0">
			<dt className="label-caps">{label}</dt>
			<dd className="mt-1 break-words">{children}</dd>
		</div>
	);
}
