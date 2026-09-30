import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ChevronLeft,
	ChevronRight,
	Plus,
	Search as SearchIcon,
	SlidersHorizontal,
	Sparkles,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CategoryPicker } from "@/components/category-picker";
import { CategoryReviewDialog } from "@/components/category-review";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { todayIso } from "@/domain/dates";
import { Money, useFormat } from "@/lib/format";
import {
	amount,
	optStr,
	reportError,
	str,
	toAmountInput,
	useInvalidateAll,
} from "@/lib/forms";
import {
	CATEGORY_SOURCE_LABELS,
	INVESTMENT_TRANSACTION_KIND_LABELS,
	importSourceLabel,
	investmentStatusLabel,
} from "@/lib/labels";
import { orpc } from "@/lib/orpc";
import { forDirection, useRecentCategories } from "@/lib/recent-categories";
import { transactionEditPatch } from "@/lib/transaction-edit";
import {
	draftFromSearch,
	type FilterDraft,
	filterChips,
	periodPresets,
	searchFromDraft,
	type TransactionSearch,
} from "@/lib/transaction-filters";
import { cn } from "@/lib/utils";

type Search = TransactionSearch;

const PAGE = 50;

function s(v: unknown): string | undefined {
	return typeof v === "string" && v ? v : undefined;
}

export const Route = createFileRoute("/_app/transactions")({
	validateSearch: (raw: Record<string, unknown>): Search => ({
		accountId: s(raw.accountId),
		categoryId: s(raw.categoryId),
		merchantId: s(raw.merchantId),
		recurringPaymentId: s(raw.recurringPaymentId),
		q: s(raw.q),
		from: s(raw.from),
		to: s(raw.to),
		direction:
			raw.direction === "inflow" || raw.direction === "outflow"
				? raw.direction
				: undefined,
		uncategorised:
			raw.uncategorised === true || raw.uncategorised === "true"
				? true
				: undefined,
		transfers: raw.transfers === "hide" ? "hide" : undefined,
		page: typeof raw.page === "number" && raw.page > 1 ? raw.page : undefined,
		brokerPage:
			Number.isSafeInteger(Number(raw.brokerPage)) &&
			Number(raw.brokerPage) > 1 &&
			Number(raw.brokerPage) <= 2000
				? Number(raw.brokerPage)
				: undefined,
		sort:
			raw.sort === "date_asc" ||
			raw.sort === "amount_desc" ||
			raw.sort === "amount_asc"
				? raw.sort
				: undefined,
		highlight: s(raw.highlight),
	}),
	loaderDeps: ({ search }) => search,
	loader: async ({ context, deps }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(
				orpc.transactions.list.queryOptions({ input: toFilter(deps) }),
			),
			context.queryClient.ensureQueryData(orpc.categories.list.queryOptions()),
			context.queryClient.ensureQueryData(
				orpc.accounts.list.queryOptions({ input: {} }),
			),
			context.queryClient.ensureQueryData(
				orpc.investments.sourceAccounts.queryOptions(),
			),
			context.queryClient.ensureQueryData(
				orpc.investments.sourceTransactionPage.queryOptions({
					input: {
						from: deps.from,
						to: deps.to,
						direction: deps.direction,
						limit: PAGE,
						offset: ((deps.brokerPage ?? 1) - 1) * PAGE,
					},
				}),
			),
		]);
	},
	head: () => ({ meta: [{ title: "Transaktionen · Fortuna" }] }),
	component: TransactionsPage,
});

function toFilter(sp: Search) {
	return {
		accountId: sp.accountId,
		categoryId: sp.categoryId,
		merchantId: sp.merchantId,
		recurringPaymentId: sp.recurringPaymentId,
		q: sp.q,
		from: sp.from,
		to: sp.to,
		direction: sp.direction,
		uncategorised: sp.uncategorised,
		includeTransfers: sp.transfers !== "hide",
		limit: PAGE,
		offset: ((sp.page ?? 1) - 1) * PAGE,
		sort: sp.sort ?? "date_desc",
	};
}

function TransactionsPage() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const { data } = useSuspenseQuery(
		orpc.transactions.list.queryOptions({ input: toFilter(search) }),
	);
	const { data: categories } = useSuspenseQuery(
		orpc.categories.list.queryOptions(),
	);
	const { data: accounts } = useSuspenseQuery(
		orpc.accounts.list.queryOptions({ input: {} }),
	);
	const { data: sourceAccounts } = useSuspenseQuery(
		orpc.investments.sourceAccounts.queryOptions(),
	);
	const { data: brokerActivity } = useSuspenseQuery(
		orpc.investments.sourceTransactionPage.queryOptions({
			input: {
				from: search.from,
				to: search.to,
				direction: search.direction,
				limit: PAGE,
				offset: ((search.brokerPage ?? 1) - 1) * PAGE,
			},
		}),
	);
	const f = useFormat();
	const invalidate = useInvalidateAll();
	const [selected, setSelected] = useState<string | null>(
		search.highlight ?? null,
	);
	const [adding, setAdding] = useState(false);
	const [reviewing, setReviewing] = useState(false);
	const [filtering, setFiltering] = useState(false);
	const [recent, pushRecent] = useRecentCategories();
	const listTop = useRef<HTMLDivElement>(null);
	const [q, setQ] = useState(search.q ?? "");
	// Cheap enough to keep live: the same query the review itself runs on.
	const { data: reviewCounts } = useQuery({
		...orpc.categorisation.review.queryOptions(),
		staleTime: 30_000,
	});
	const uncategorisedCount = reviewCounts
		? reviewCounts.certain.length +
			reviewCounts.uncertain.length +
			reviewCounts.unknown.length +
			reviewCounts.remaining
		: 0;
	useEffect(() => setQ(search.q ?? ""), [search.q]);

	const update = useMutation(
		orpc.transactions.update.mutationOptions({
			onSuccess: () => invalidate(),
			onError: reportError,
		}),
	);
	const detectTransfers = useMutation(
		orpc.transactions.detectTransfers.mutationOptions({
			onSuccess: async (n) => {
				await invalidate();
				toast.success(`${n} Umbuchungspaare verknüpft`);
			},
			onError: reportError,
		}),
	);

	const set = (patch: Partial<Search>) =>
		navigate({
			search: (prev) => ({
				...prev,
				...patch,
				page: patch.page ?? undefined,
				brokerPage: patch.brokerPage ?? undefined,
			}),
		});
	const pages = Math.max(1, Math.ceil(data.total / PAGE));
	const page = search.page ?? 1;
	const brokerPage = search.brokerPage ?? 1;
	const brokerPages = Math.max(1, Math.ceil(brokerActivity.total / PAGE));
	const showBrokerActivity =
		!search.accountId &&
		!search.categoryId &&
		!search.merchantId &&
		!search.recurringPaymentId &&
		!search.q &&
		!search.uncategorised;
	const parents = categories.filter((c) => !c.parentId);
	const categoryOptions = parents.flatMap((p) => [
		p,
		...categories.filter((c) => c.parentId === p.id),
	]);
	const chips = filterChips(search, {
		accounts,
		categories,
		merchant: search.merchantId
			? (data.rows.find((row) => row.merchantId === search.merchantId)
					?.merchantName ?? null)
			: null,
		recurring: search.recurringPaymentId
			? (data.rows.find(
					(row) => row.recurringPaymentId === search.recurringPaymentId,
				)?.recurringName ?? null)
			: null,
	});
	const goToPage = (next: number) => {
		navigate({
			search: (p) => ({ ...p, page: next > 1 ? next : undefined }),
		}).then(() =>
			// A new page starts at its first booking, not wherever the
			// previous one was scrolled to.
			listTop.current?.scrollIntoView({ block: "start" }),
		);
	};

	return (
		<div className="space-y-4">
			<PageHeader
				title="Transaktionen"
				subtitle={`${data.total.toLocaleString(f.locale)} Bankbuchungen${showBrokerActivity && sourceAccounts.length ? ` · ${brokerActivity.total.toLocaleString(f.locale)} Depotbuchungen` : ""} · vollständige Historie, ${PAGE} je Seite`}
				actions={
					<>
						<Button
							variant="outline"
							onClick={() => detectTransfers.mutate(undefined)}
							disabled={detectTransfers.isPending}
						>
							Umbuchungen erkennen
						</Button>
						<Button variant="outline" onClick={() => setReviewing(true)}>
							<Sparkles /> Zuordnen lassen
						</Button>
						<Button onClick={() => setAdding(true)}>
							<Plus /> Hinzufügen
						</Button>
					</>
				}
			/>
			{uncategorisedCount > 0 ? (
				<Card className="flex flex-wrap items-center justify-between gap-3 p-3">
					<p className="text-sm text-text-secondary">
						<strong className="text-text">
							{uncategorisedCount.toLocaleString(f.locale)}
						</strong>{" "}
						{uncategorisedCount === 1 ? "Buchung hat" : "Buchungen haben"} noch
						keine Kategorie.
					</p>
					<Button size="sm" onClick={() => setReviewing(true)}>
						<Sparkles /> Zuordnen lassen
					</Button>
				</Card>
			) : null}
			{/* Search stays in reach while scrolling a long list: under the
			    phone header on a phone, at the top of the window on a desk. */}
			<div className="sticky top-[var(--phone-header-height,65px)] z-30 -mx-3 space-y-2 border-b border-border bg-bg/95 px-3 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:top-0 lg:-mx-8 lg:px-8">
				<form
					className="flex items-center gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						set({ q: q.trim() || undefined });
						// Closes the phone keyboard so the results are visible.
						(document.activeElement as HTMLElement | null)?.blur();
					}}
				>
					<div className="relative min-w-0 flex-1">
						<label htmlFor="tx-q" className="sr-only">
							Buchungen durchsuchen
						</label>
						<SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-muted" />
						<Input
							id="tx-q"
							type="search"
							enterKeyHint="search"
							value={q}
							onChange={(e) => setQ(e.target.value)}
							placeholder="Händler, Beschreibung, Notiz …"
							className="pr-9 pl-8 [&::-webkit-search-cancel-button]:hidden"
						/>
						{q ? (
							<button
								type="button"
								aria-label="Suche leeren"
								className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-control text-text-muted hover:text-text sm:size-7"
								onClick={() => {
									setQ("");
									if (search.q) set({ q: undefined });
								}}
							>
								<X className="size-4" />
							</button>
						) : null}
					</div>
					<Button
						type="button"
						variant="outline"
						className="shrink-0 max-sm:h-11"
						onClick={() => setFiltering(true)}
						aria-label={
							chips.length ? `Filter, ${chips.length} aktiv` : "Filter"
						}
					>
						<SlidersHorizontal />
						<span className="max-[359px]:sr-only">Filter</span>
						{chips.length ? (
							<Badge variant="brand" className="ml-0.5">
								{chips.length}
							</Badge>
						) : null}
					</Button>
				</form>
				{chips.length ? (
					<ul className="flex flex-wrap gap-1.5" aria-label="Aktive Filter">
						{chips.map((chip) => (
							<li key={chip.key} className="max-w-full">
								<button
									type="button"
									onClick={() => set(chip.clear)}
									aria-label={`Filter „${chip.label}" entfernen`}
									className="inline-flex min-h-9 max-w-full items-center gap-1 rounded-full border border-brand/30 bg-brand-subtle px-3 text-left text-xs text-brand hover:border-brand sm:min-h-7"
								>
									<span className="min-w-0 break-words">{chip.label}</span>
									<X className="size-3.5 shrink-0" />
								</button>
							</li>
						))}
						{chips.length > 1 ? (
							<li>
								<button
									type="button"
									onClick={() =>
										navigate({ search: search.q ? { q: search.q } : {} })
									}
									className="inline-flex min-h-9 items-center px-2 text-xs text-text-secondary underline-offset-2 hover:underline sm:min-h-7"
								>
									Alle entfernen
								</button>
							</li>
						) : null}
					</ul>
				) : null}
			</div>
			{!showBrokerActivity && sourceAccounts.length > 0 ? (
				<p className="text-xs text-text-muted">
					Konto-, Kategorie- und Textfilter betreffen nur Bankbuchungen. Die
					vollständige Depot-Historie bleibt im jeweiligen Depot zugänglich.
				</p>
			) : null}
			<Card>
				<div ref={listTop} className="scroll-mt-32 lg:scroll-mt-24">
					<CardHeader
						title={`Bankkonten (${data.total.toLocaleString(f.locale)})`}
						subtitle={
							search.accountId
								? `Nur ${accounts.find((account) => account.id === search.accountId)?.name ?? "dieses Konto"}`
								: "Alle Bank- und Bargeldkonten, ohne Datumsgrenze"
						}
					/>
				</div>
				{data.rows.length === 0 ? (
					<EmptyState
						title="Keine passenden Transaktionen"
						description="Passe die Filter an, importiere eine CSV-Datei oder füge eine Transaktion manuell hinzu."
					/>
				) : (
					<>
						{/* A phone gets one stacked row per booking: who, how much,
						    and below it when and where it is filed. */}
						<ul className="divide-y divide-border border-t border-border sm:hidden">
							{data.rows.map((t) => (
								<li key={t.id}>
									<button
										type="button"
										onClick={() => setSelected(t.id)}
										className={cn(
											"flex min-h-14 w-full items-start gap-3 px-4 py-3 text-left transition-colors active:bg-surface-sunken",
											selected === t.id && "bg-brand-subtle",
										)}
									>
										<span className="min-w-0 flex-1">
											<span className="block break-words text-sm text-text">
												{t.merchantName ?? t.counterpartyName ?? t.description}
											</span>
											<span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-text-muted">
												<span>{f.date(t.bookingDate, "short")}</span>
												<span aria-hidden>·</span>
												{t.transferGroupId ? (
													<span>Umbuchung</span>
												) : t.categoryName ? (
													<span className="break-words text-text-secondary">
														{t.categoryName}
													</span>
												) : (
													<span className="text-warning">Ohne Kategorie</span>
												)}
												{t.status === "pending" ? (
													<Badge variant="accent">ausstehend</Badge>
												) : null}
											</span>
										</span>
										<Money
											amountMinor={t.amountMinor}
											currency={t.currency}
											className="shrink-0 text-sm"
											tone={
												t.transferGroupId
													? "muted"
													: t.amountMinor > 0
														? "positive"
														: "default"
											}
										/>
									</button>
								</li>
							))}
						</ul>
						<div className="max-sm:hidden">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Datum</TableHead>
										<TableHead>Händler / Beschreibung</TableHead>
										<TableHead className="hidden md:table-cell">
											Kategorie
										</TableHead>
										<TableHead className="hidden lg:table-cell">
											Konto
										</TableHead>
										<TableHead className="text-right">Betrag</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{data.rows.map((t) => (
										<TableRow
											key={t.id}
											data-state={selected === t.id ? "selected" : undefined}
											onActivate={() => setSelected(t.id)}
										>
											<TableCell className="font-mono text-xs text-text-muted">
												{f.date(t.bookingDate, "short")}
												{t.status === "pending" ? (
													<Badge variant="accent" className="ml-1.5">
														ausstehend
													</Badge>
												) : null}
											</TableCell>
											<TableCell className="max-w-[360px]">
												<span className="block break-words text-text">
													{t.merchantName ??
														t.counterpartyName ??
														t.description}
												</span>
												<span className="block break-words text-[11px] text-text-muted">
													{t.description}
												</span>
												<span className="block break-words text-[11px] text-text-secondary md:hidden">
													{t.transferGroupId
														? "Umbuchung"
														: (t.categoryName ?? "Ohne Kategorie")}
												</span>
											</TableCell>
											<TableCell
												className="hidden md:table-cell"
												onClick={(e) => e.stopPropagation()}
											>
												{t.transferGroupId ? (
													<Badge>Umbuchung</Badge>
												) : (
													<NativeSelect
														aria-label={`Kategorie für ${t.description}`}
														value={t.categoryId ?? ""}
														onChange={(e) => {
															const value = e.target.value || null;
															if (value) pushRecent(value);
															update.mutate({ id: t.id, categoryId: value });
														}}
														className={cn(
															"h-7 w-full min-w-40 text-xs",
															!t.categoryId && "border-dashed text-text-muted",
														)}
													>
														<option value="">Nicht kategorisiert</option>
														{categoryOptions.map((c) => (
															<option key={c.id} value={c.id}>
																{c.parentId ? `  ${c.name}` : c.name}
															</option>
														))}
													</NativeSelect>
												)}
												{t.recurringName ? (
													<Badge variant="brand" className="ml-1.5">
														wiederkehrend
													</Badge>
												) : null}
											</TableCell>
											<TableCell className="hidden text-text-secondary lg:table-cell">
												{t.accountName}
											</TableCell>
											<TableCell className="text-right">
												<Money
													amountMinor={t.amountMinor}
													currency={t.currency}
													tone={
														t.transferGroupId
															? "muted"
															: t.amountMinor > 0
																? "positive"
																: "default"
													}
												/>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					</>
				)}
				{pages > 1 ? (
					<div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs text-text-secondary">
						<Button
							variant="ghost"
							size="sm"
							className="max-sm:h-11"
							disabled={page <= 1}
							onClick={() => goToPage(page - 1)}
							aria-label="Vorherige Seite"
						>
							<ChevronLeft />
							<span className="sm:sr-only">Zurück</span>
						</Button>
						<span>
							Seite {page} von {pages}
						</span>
						<Button
							variant="ghost"
							size="sm"
							className="max-sm:h-11"
							disabled={page >= pages}
							onClick={() => goToPage(page + 1)}
							aria-label="Nächste Seite"
						>
							<span className="sm:sr-only">Weiter</span>
							<ChevronRight />
						</Button>
					</div>
				) : null}
			</Card>
			{showBrokerActivity && sourceAccounts.length > 0 ? (
				<Card>
					<CardHeader
						title={`Depotbuchungen (${brokerActivity.total.toLocaleString(f.locale)})`}
						subtitle="Eigene Historie aus den Broker-Depots. Diese Buchungen werden nicht erneut als Bank-Cashflow oder Vermögen addiert."
					/>
					{brokerActivity.rows.length === 0 ? (
						<EmptyState
							title="Keine Depotbuchungen"
							description="Für den gewählten Zeitraum liegen keine Brokerbuchungen vor."
						/>
					) : (
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Zeitpunkt</TableHead>
										<TableHead>Art</TableHead>
										<TableHead>Wertpapier / Referenz</TableHead>
										<TableHead>Depot</TableHead>
										<TableHead className="text-right">Betrag</TableHead>
										<TableHead>Status</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{brokerActivity.rows.map((transaction) => {
										const depot = sourceAccounts.find(
											(account) => account.id === transaction.accountId,
										);
										return (
											<TableRow key={transaction.id}>
												<TableCell className="whitespace-nowrap text-xs">
													{f.dateTime(transaction.occurredAt)}
												</TableCell>
												<TableCell>
													{INVESTMENT_TRANSACTION_KIND_LABELS[
														transaction.kind
													] ?? transaction.kind}
												</TableCell>
												<TableCell>
													<span className="block break-words">
														{transaction.instrumentName ?? "—"}
													</span>
													<span className="block font-mono text-[11px] text-text-muted">
														{transaction.isin ??
															`Referenz ···${transaction.sourceId.slice(-8)}`}
													</span>
												</TableCell>
												<TableCell>
													{depot ? (
														<Link
															to="/depots/$id"
															params={{ id: depot.id }}
															search={{ page: 1 }}
															className="text-brand hover:underline"
														>
															{depot.label}
														</Link>
													) : (
														"Depot"
													)}
												</TableCell>
												<TableCell className="text-right">
													<Money
														amountMinor={transaction.amountMinor}
														currency={transaction.currency}
														tone="auto"
														signed
													/>
												</TableCell>
												<TableCell>
													{investmentStatusLabel(transaction.status)}
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						</div>
					)}
					{brokerPages > 1 ? (
						<div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-text-secondary">
							<span>
								Depot-Seite {brokerPage} von {brokerPages}
							</span>
							<div className="flex gap-1">
								<Button
									variant="ghost"
									size="icon-sm"
									disabled={brokerPage <= 1}
									onClick={() =>
										navigate({
											search: (prev) => ({
												...prev,
												brokerPage:
													brokerPage - 1 > 1 ? brokerPage - 1 : undefined,
											}),
										})
									}
									aria-label="Vorherige Depot-Seite"
								>
									<ChevronLeft />
								</Button>
								<Button
									variant="ghost"
									size="icon-sm"
									disabled={brokerPage >= brokerPages}
									onClick={() =>
										navigate({
											search: (prev) => ({
												...prev,
												brokerPage: brokerPage + 1,
											}),
										})
									}
									aria-label="Nächste Depot-Seite"
								>
									<ChevronRight />
								</Button>
							</div>
						</div>
					) : null}
				</Card>
			) : null}
			{selected ? (
				<TransactionDialog
					id={selected}
					onClose={() => setSelected(null)}
					categories={categoryOptions}
					recent={recent}
					onPicked={pushRecent}
				/>
			) : null}
			{filtering ? (
				<FilterSheet
					search={search}
					accounts={accounts}
					categories={categoryOptions}
					onApply={(patch) => {
						setFiltering(false);
						set(patch);
					}}
					onClose={() => setFiltering(false)}
				/>
			) : null}
			<AddTransactionDialog
				open={adding}
				onOpenChange={setAdding}
				accounts={accounts}
				categories={categoryOptions}
			/>
			<CategoryReviewDialog open={reviewing} onOpenChange={setReviewing} />
		</div>
	);
}

type Cat = {
	id: string;
	name: string;
	parentId: string | null;
	kind?: string;
};

/**
 * Every filter in one sheet instead of a row of controls that took a whole
 * phone screen before the first booking. Nothing applies until "Anzeigen",
 * so changing three filters loads the list once, not three times.
 */
function FilterSheet({
	search,
	accounts,
	categories,
	onApply,
	onClose,
}: {
	search: Search;
	accounts: { id: string; name: string }[];
	categories: Cat[];
	onApply: (patch: Partial<Search>) => void;
	onClose: () => void;
}) {
	const [draft, setDraft] = useState<FilterDraft>(() =>
		draftFromSearch(search),
	);
	const edit = (patch: Partial<FilterDraft>) =>
		setDraft((current) => ({ ...current, ...patch }));
	const presets = periodPresets(todayIso());
	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent title="Filter" className="max-w-lg">
				<form
					className="grid gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						onApply(searchFromDraft(draft));
					}}
				>
					<Field label="Konto" htmlFor="tx-account">
						<NativeSelect
							id="tx-account"
							value={draft.accountId ?? ""}
							onChange={(e) => edit({ accountId: e.target.value || undefined })}
						>
							<option value="">Alle Konten</option>
							{accounts.map((a) => (
								<option key={a.id} value={a.id}>
									{a.name}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field label="Kategorie" htmlFor="tx-category">
						<NativeSelect
							id="tx-category"
							value={draft.uncategorised ? "__none" : (draft.categoryId ?? "")}
							onChange={(e) => {
								const { value } = e.target;
								edit(
									value === "__none"
										? { uncategorised: true, categoryId: undefined }
										: {
												categoryId: value || undefined,
												uncategorised: undefined,
											},
								);
							}}
						>
							<option value="">Alle Kategorien</option>
							<option value="__none">Ohne Kategorie</option>
							{categories.map((c) => (
								<option key={c.id} value={c.id}>
									{c.parentId ? `  ${c.name}` : c.name}
								</option>
							))}
						</NativeSelect>
					</Field>
					<fieldset className="space-y-2">
						<legend className="label-caps mb-2">Zeitraum</legend>
						<div className="flex flex-wrap gap-2">
							{presets.map((preset) => {
								const active =
									draft.from === preset.from && draft.to === preset.to;
								return (
									<button
										key={preset.key}
										type="button"
										aria-pressed={active}
										onClick={() =>
											edit(
												active
													? { from: undefined, to: undefined }
													: { from: preset.from, to: preset.to },
											)
										}
										className={cn(
											"min-h-11 rounded-control border px-3 text-sm sm:min-h-8 sm:text-xs",
											active
												? "border-brand bg-brand-subtle text-brand"
												: "border-border-strong bg-surface text-text hover:border-brand",
										)}
									>
										{preset.label}
									</button>
								);
							})}
						</div>
						<div className="grid grid-cols-2 gap-2">
							<Field label="Von" htmlFor="tx-from">
								<Input
									id="tx-from"
									type="date"
									value={draft.from ?? ""}
									onChange={(e) => edit({ from: e.target.value || undefined })}
									className="min-w-0"
								/>
							</Field>
							<Field label="Bis" htmlFor="tx-to">
								<Input
									id="tx-to"
									type="date"
									value={draft.to ?? ""}
									onChange={(e) => edit({ to: e.target.value || undefined })}
									className="min-w-0"
								/>
							</Field>
						</div>
					</fieldset>
					<fieldset>
						<legend className="label-caps mb-2">Richtung</legend>
						<div className="grid grid-cols-3 gap-1 rounded-control border border-border-strong p-1">
							{(
								[
									[undefined, "Beide"],
									["outflow", "Ausgaben"],
									["inflow", "Einnahmen"],
								] as const
							).map(([value, label]) => (
								<button
									key={label}
									type="button"
									aria-pressed={draft.direction === value}
									onClick={() => edit({ direction: value })}
									className={cn(
										"min-h-10 rounded-[6px] text-sm sm:min-h-7 sm:text-xs",
										draft.direction === value
											? "bg-brand text-text-inverse"
											: "text-text-secondary hover:bg-surface-sunken",
									)}
								>
									{label}
								</button>
							))}
						</div>
					</fieldset>
					<Field label="Sortierung" htmlFor="tx-sort">
						<NativeSelect
							id="tx-sort"
							value={draft.sort ?? "date_desc"}
							onChange={(e) => edit({ sort: e.target.value as Search["sort"] })}
						>
							<option value="date_desc">Neueste zuerst</option>
							<option value="date_asc">Älteste zuerst</option>
							<option value="amount_desc">Größte Einnahme</option>
							<option value="amount_asc">Größte Ausgabe</option>
						</NativeSelect>
					</Field>
					<label className="flex min-h-11 items-center gap-2 text-sm text-text-secondary sm:min-h-8">
						<input
							type="checkbox"
							checked={draft.transfers === "hide"}
							onChange={(e) => {
								const { checked } = e.currentTarget;
								edit({ transfers: checked ? "hide" : undefined });
							}}
							className="size-4 accent-brand"
						/>
						Umbuchungen ausblenden
					</label>
					<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
						<Button
							type="button"
							variant="ghost"
							className="max-sm:h-11"
							onClick={() => setDraft({})}
						>
							Zurücksetzen
						</Button>
						<Button type="submit" className="max-sm:h-11 max-sm:flex-1">
							Anzeigen
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function TransactionDialog({
	id,
	onClose,
	categories,
	recent,
	onPicked,
}: {
	id: string;
	onClose: () => void;
	categories: Cat[];
	recent: string[];
	onPicked: (categoryId: string) => void;
}) {
	const { data: t } = useQuery(
		orpc.transactions.get.queryOptions({ input: { id } }),
	);
	const { data: recurring } = useQuery(
		orpc.recurring.list.queryOptions({ input: { includeInactive: true } }),
	);
	const f = useFormat();
	// The form waits for the recurring payments too: rendered before they
	// arrived, the select fell back to "Keine" and saving unlinked the booking.
	if (!t || !recurring) return null;
	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent
				title={t.merchantName ?? t.counterpartyName ?? t.description}
				description={`${t.accountName} · ${f.date(t.bookingDate)}${t.valueDate && t.valueDate !== t.bookingDate ? ` (Wertstellung ${f.date(t.valueDate)})` : ""}`}
				className="max-w-xl"
			>
				<TransactionEditor
					t={t}
					recurring={recurring}
					categories={categories}
					recent={recent}
					onPicked={onPicked}
					onClose={onClose}
				/>
			</DialogContent>
		</Dialog>
	);
}

type LoadedTransaction = Awaited<ReturnType<typeof orpc.transactions.get.call>>;

/**
 * Category first: it is what the booking is opened for nine times out of
 * ten. Choosing one saves at once, together with anything else changed
 * below, and closes the sheet — the list underneath stays where it was.
 */
function TransactionEditor({
	t,
	recurring,
	categories,
	recent,
	onPicked,
	onClose,
}: {
	t: LoadedTransaction;
	recurring: { id: string; name: string }[];
	categories: Cat[];
	recent: string[];
	onPicked: (categoryId: string) => void;
	onClose: () => void;
}) {
	const invalidate = useInvalidateAll();
	const formRef = useRef<HTMLFormElement>(null);
	const [categoryId, setCategoryId] = useState<string | null>(t.categoryId);
	const [createRule, setCreateRule] = useState(false);
	const [linkId, setLinkId] = useState("");
	const isTransfer = Boolean(t.transferGroupId);
	const update = useMutation(
		orpc.transactions.update.mutationOptions({
			onSuccess: async (result) => {
				await invalidate();
				toast.success(
					result.ruleApplied > 0
						? `Gespeichert · Regel angelegt und auf ${result.ruleApplied} weitere ${result.ruleApplied === 1 ? "Buchung" : "Buchungen"} angewendet`
						: "Gespeichert",
				);
				onClose();
			},
			onError: reportError,
		}),
	);
	const createCategory = useMutation(
		orpc.categories.create.mutationOptions({ onError: reportError }),
	);
	const remove = useMutation(
		orpc.transactions.delete.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Gelöscht");
				onClose();
			},
			onError: reportError,
		}),
	);
	const unlink = useMutation(
		orpc.transactions.unlinkTransfer.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Umbuchung getrennt");
			},
			onError: reportError,
		}),
	);
	const link = useMutation(
		orpc.transactions.linkTransfer.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Als Umbuchung verknüpft");
				onClose();
			},
			onError: reportError,
		}),
	);

	/** Sends only what changed (`transactionEditPatch`), with this category. */
	const save = (chosen: string | null) => {
		const form = formRef.current ? new FormData(formRef.current) : null;
		const patch = transactionEditPatch(t, {
			categoryId: chosen,
			merchantName: form ? optStr(form, "merchantName") : t.merchantName,
			notes: form ? optStr(form, "notes") : t.notes,
			status: form ? (str(form, "status") as "pending" | "booked") : t.status,
			recurringPaymentId: form
				? optStr(form, "recurringPaymentId")
				: t.recurringPaymentId,
			createRule,
		});
		if (Object.keys(patch).length === 1) return onClose();
		if (patch.categoryId) onPicked(patch.categoryId);
		update.mutate(patch);
	};
	const pick = (chosen: string | null) => {
		setCategoryId(chosen);
		save(chosen);
	};
	const busy = update.isPending || createCategory.isPending;

	return (
		<>
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<Money
					amountMinor={t.amountMinor}
					currency={t.currency}
					tone={t.amountMinor > 0 ? "positive" : "default"}
					className="text-2xl"
				/>
				<div className="flex flex-wrap gap-1">
					{isTransfer ? <Badge>interne Umbuchung</Badge> : null}
					{t.status === "pending" ? (
						<Badge variant="accent">ausstehend</Badge>
					) : null}
				</div>
			</div>
			<p className="-mt-2 break-words text-xs text-text-secondary">
				{t.description}
			</p>

			<section className="space-y-2" aria-labelledby="d-cat-heading">
				<div className="flex flex-wrap items-baseline justify-between gap-2">
					<h3 id="d-cat-heading" className="label-caps">
						Kategorie
					</h3>
					{t.categorySource ? (
						<span className="text-[11px] text-text-muted">
							{CATEGORY_SOURCE_LABELS[t.categorySource] ?? "—"}
						</span>
					) : null}
				</div>
				{isTransfer ? (
					<p className="text-sm text-text-secondary">
						Eine interne Umbuchung braucht keine Kategorie.
					</p>
				) : (
					<>
						{t.merchantName ? (
							// Before the picker: choosing a category saves at once.
							<label className="flex min-h-9 items-start gap-2 text-xs text-text-secondary">
								<input
									type="checkbox"
									checked={createRule}
									onChange={(e) => {
										const { checked } = e.currentTarget;
										setCreateRule(checked);
									}}
									className="mt-0.5 size-4 shrink-0 accent-brand"
								/>
								<span>
									Als Regel merken: gilt dann für alle Buchungen von{" "}
									{t.merchantName}, auch ältere ohne Kategorie
								</span>
							</label>
						) : null}
						<CategoryPicker
							categories={forDirection(categories, t.amountMinor < 0)}
							value={categoryId}
							recent={recent}
							disabled={busy}
							creating={createCategory.isPending}
							onPick={pick}
							onCreate={(name) =>
								createCategory.mutate(
									{
										name,
										// The sign already says which it is.
										kind: t.amountMinor < 0 ? "expense" : "income",
									},
									{
										onSuccess: (category) => {
											toast.success(`Kategorie „${category.name}" angelegt`);
											pick(category.id);
										},
									},
								)
							}
						/>
					</>
				)}
			</section>

			<form
				ref={formRef}
				onSubmit={(e) => {
					e.preventDefault();
					save(categoryId);
				}}
				className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2"
			>
				<Field label="Händler" htmlFor="d-merchant">
					<Input
						id="d-merchant"
						name="merchantName"
						defaultValue={t.merchantName ?? ""}
					/>
				</Field>
				<Field label="Status" htmlFor="d-status">
					<NativeSelect id="d-status" name="status" defaultValue={t.status}>
						<option value="booked">Gebucht</option>
						<option value="pending">Ausstehend (geplant)</option>
					</NativeSelect>
				</Field>
				<Field
					label="Wiederkehrende Zahlung"
					htmlFor="d-rec"
					className="sm:col-span-2"
				>
					<NativeSelect
						id="d-rec"
						name="recurringPaymentId"
						defaultValue={t.recurringPaymentId ?? ""}
					>
						<option value="">Keine</option>
						{recurring.map((r) => (
							<option key={r.id} value={r.id}>
								{r.name}
							</option>
						))}
					</NativeSelect>
				</Field>
				<Field label="Notizen" htmlFor="d-notes" className="sm:col-span-2">
					<Textarea
						id="d-notes"
						name="notes"
						defaultValue={t.notes ?? ""}
						rows={2}
					/>
				</Field>
				<div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
					<Button
						type="button"
						variant="destructive"
						size="sm"
						className="max-sm:h-11"
						onClick={() => {
							if (confirm("Diese Transaktion löschen?"))
								remove.mutate({ id: t.id });
						}}
					>
						Löschen
					</Button>
					<div className="flex gap-2">
						<Button
							type="button"
							variant="ghost"
							className="max-sm:h-11"
							onClick={onClose}
						>
							Abbrechen
						</Button>
						<Button type="submit" disabled={busy} className="max-sm:h-11">
							Speichern
						</Button>
					</div>
				</div>
			</form>

			<details className="border-t border-border pt-3 text-xs">
				<summary className="flex min-h-9 cursor-pointer items-center font-medium text-text-secondary">
					Buchungsdetails und Umbuchung
				</summary>
				<dl className="mt-2 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
					<dt className="text-text-muted">Konto</dt>
					<dd className="break-words">{t.accountName}</dd>
					{t.counterpartyName ? (
						<>
							<dt className="text-text-muted">Gegenpartei</dt>
							<dd className="break-words">{t.counterpartyName}</dd>
						</>
					) : null}
					{t.counterpartyIban ? (
						<>
							<dt className="text-text-muted">IBAN</dt>
							<dd className="break-all font-mono">{t.counterpartyIban}</dd>
						</>
					) : null}
					{t.externalId ? (
						<>
							<dt className="text-text-muted">Externe ID</dt>
							<dd className="break-all font-mono">{t.externalId}</dd>
						</>
					) : null}
					<dt className="text-text-muted">Quelle</dt>
					<dd>{importSourceLabel(t.importSource)}</dd>
				</dl>
				{isTransfer ? (
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="mt-3 max-sm:h-11"
						onClick={() => unlink.mutate({ id: t.id })}
					>
						Umbuchung trennen
					</Button>
				) : (
					<div className="mt-3">
						<p className="label-caps mb-2">Als interne Umbuchung verknüpfen</p>
						<div className="flex gap-2">
							<Input
								value={linkId}
								onChange={(e) => setLinkId(e.target.value)}
								placeholder="Transaktions-ID der Gegenseite"
								aria-label="Transaktions-ID der Gegenseite"
								className="font-mono text-xs"
							/>
							<Button
								type="button"
								variant="outline"
								className="max-sm:h-11"
								disabled={!linkId || link.isPending}
								onClick={() =>
									link.mutate(
										t.amountMinor < 0
											? { outflowId: t.id, inflowId: linkId.trim() }
											: { outflowId: linkId.trim(), inflowId: t.id },
									)
								}
							>
								Verknüpfen
							</Button>
						</div>
						<p className="mt-1 break-all font-mono text-[10px] text-text-muted">
							Diese Transaktion: {t.id}
						</p>
					</div>
				)}
			</details>
		</>
	);
}

function AddTransactionDialog({
	open,
	onOpenChange,
	accounts,
	categories,
}: {
	open: boolean;
	onOpenChange: (o: boolean) => void;
	accounts: { id: string; name: string; currency: string }[];
	categories: Cat[];
}) {
	const invalidate = useInvalidateAll();
	const create = useMutation(
		orpc.transactions.create.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success("Transaktion hinzugefügt");
				onOpenChange(false);
			},
			onError: reportError,
		}),
	);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title="Transaktion hinzufügen"
				description="Negative Beträge verlassen das Konto. Markiere bekannte künftige Zahlungen als ausstehend, damit sie in die Prognose einfließen."
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						const form = new FormData(e.currentTarget);
						const value = amount(form, "amount");
						if (value === null) return toast.error("Betrag eingeben");
						create.mutate({
							accountId: str(form, "accountId"),
							bookingDate: str(form, "bookingDate"),
							amountMinor: value,
							description: str(form, "description"),
							counterpartyName: optStr(form, "counterpartyName"),
							categoryId: optStr(form, "categoryId"),
							status: str(form, "status") as "pending" | "booked",
							notes: optStr(form, "notes"),
						});
					}}
					className="grid gap-3 sm:grid-cols-2"
				>
					<Field label="Konto" htmlFor="a-acc">
						<NativeSelect id="a-acc" name="accountId" required>
							{accounts.map((a) => (
								<option key={a.id} value={a.id}>
									{a.name} ({a.currency})
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field label="Datum" htmlFor="a-date">
						<Input
							id="a-date"
							name="bookingDate"
							type="date"
							defaultValue={todayIso()}
							required
						/>
					</Field>
					<Field label="Betrag" htmlFor="a-amount">
						<Input
							id="a-amount"
							name="amount"
							inputMode="decimal"
							placeholder="−12,50"
							required
							className="amount"
							autoFocus
						/>
					</Field>
					<Field label="Status" htmlFor="a-status">
						<NativeSelect id="a-status" name="status" defaultValue="booked">
							<option value="booked">Gebucht</option>
							<option value="pending">Ausstehend (geplant)</option>
						</NativeSelect>
					</Field>
					<Field
						label="Beschreibung"
						htmlFor="a-desc"
						className="sm:col-span-2"
					>
						<Input id="a-desc" name="description" required maxLength={200} />
					</Field>
					<Field label="Gegenpartei / Händler" htmlFor="a-cp">
						<Input id="a-cp" name="counterpartyName" maxLength={200} />
					</Field>
					<Field label="Kategorie" htmlFor="a-cat">
						<NativeSelect id="a-cat" name="categoryId" defaultValue="">
							<option value="">Regeln entscheiden lassen</option>
							{categories.map((c) => (
								<option key={c.id} value={c.id}>
									{c.parentId ? `  ${c.name}` : c.name}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field label="Notizen" htmlFor="a-notes" className="sm:col-span-2">
						<Textarea id="a-notes" name="notes" rows={2} />
					</Field>
					<div className="flex justify-end gap-2 sm:col-span-2">
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
						>
							Abbrechen
						</Button>
						<Button type="submit" disabled={create.isPending}>
							Hinzufügen
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export { toAmountInput };
