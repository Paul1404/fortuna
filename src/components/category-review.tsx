import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, NativeSelect } from "@/components/ui/input";
import { readConsultation } from "@/domain/categorisation";
import { Money, useFormat } from "@/lib/format";
import { reportError, useInvalidateAll } from "@/lib/forms";
import { orpc } from "@/lib/orpc";
import {
	groupByMerchant,
	type MerchantGroup,
	openPicks,
	seedCertainPicks,
	sharedPick,
} from "@/lib/review-groups";
import { cn } from "@/lib/utils";

/**
 * Batch review of uncategorised bookings.
 *
 * Everything lands in one sheet, including the proposals that come from the
 * owner's own rules and merchant defaults: those are pre-ticked because they
 * only repeat a decision they already made, but nothing is written until they
 * press a button — "Übernehmen" on one merchant, or "Alle bestätigen" at the
 * foot. The proposals resting on a guess start blank and have to be picked.
 */

type Review = Awaited<ReturnType<typeof orpc.categorisation.review.call>>;
type Row = Review["certain"][number];

/** Sentinel option value; no category can have it as an id. */
const NEW_CATEGORY = "__new__";

const SOURCE_LABELS: Record<string, string> = {
	rule: "Deine Regel",
	merchant_default: "Hinterlegt",
	recurring: "Wiederkehrend",
	history: "Wie bisher",
};

export function CategoryReviewDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (value: boolean) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title="Buchungen zuordnen"
				description="Was auf deinen Regeln, Händlern oder deinem bisherigen Verhalten beruht, ist schon ausgewählt — gespeichert wird erst beim Bestätigen."
				className="max-w-4xl"
			>
				{open ? <ReviewBody onDone={() => onOpenChange(false)} /> : null}
			</DialogContent>
		</Dialog>
	);
}

function ReviewBody({ onDone }: { onDone: () => void }) {
	const { data: review } = useSuspenseQuery(
		orpc.categorisation.review.queryOptions(),
	);
	const { data: categories } = useSuspenseQuery(
		orpc.categories.list.queryOptions(),
	);
	const { data: copilot } = useSuspenseQuery(
		orpc.copilot.status.queryOptions(),
	);
	const invalidate = useInvalidateAll();

	const allRows = useMemo(
		() => [...review.certain, ...review.uncertain, ...review.unknown],
		[review],
	);
	const openIds = useMemo(
		() => new Set(allRows.map((row) => row.id)),
		[allRows],
	);

	// Every pre-ticked row starts in the picks; the rest start absent and only
	// appear once the owner chooses something.
	const seen = useRef<Set<string>>(new Set());
	const [picks, setPicks] = useState<Record<string, string>>(
		() => seedCertainPicks(review.certain, {}, new Set()) ?? {},
	);
	// Confirming one merchant reloads the review and moves further bookings
	// up; their certain proposals are pre-ticked the same way.
	useEffect(() => {
		const next = seedCertainPicks(review.certain, picks, seen.current);
		for (const row of review.certain) seen.current.add(row.id);
		if (next) setPicks(next);
	}, [review, picks]);

	const [remember, setRemember] = useState<Record<string, boolean>>({});
	// Hr. Körner's guesses for merchants with no history, kept apart from the
	// proposals that rest on the owner's own decisions.
	const [guesses, setGuesses] = useState<Record<string, string>>({});
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});

	// Creating a category is part of filing, not a detour: the owner is looking
	// at "SV Untereuerheim 1945 e.V." and the category they need does not exist
	// yet. Sending them to Einstellungen loses the review and the place in it.
	// It files the rows it was opened for: one booking, or a whole merchant.
	const [creatingFor, setCreatingFor] = useState<{
		key: string;
		rowIds: string[];
		kind: "expense" | "income";
	} | null>(null);
	const createCategory = useMutation(
		orpc.categories.create.mutationOptions({
			onSuccess: async () => {
				await invalidate();
			},
			onError: reportError,
		}),
	);
	const createFor = (name: string) => {
		const target = creatingFor;
		if (!target) return;
		createCategory.mutate(
			{ name, kind: target.kind },
			{
				onSuccess: (category) => {
					setPickAll(target.rowIds, category.id);
					setCreatingFor(null);
					toast.success(`Kategorie „${category.name}" angelegt`);
				},
			},
		);
	};

	// Working through the leftovers with Hr. Körner. He may propose categories
	// the owner does not have — on a short list, mapping everything onto it is
	// wrong far more often than admitting a new one is needed — and he may ask
	// rather than guess. Nothing he says is written; it fills the form.
	const [session, setSession] = useState<string | null>(null);
	const [koerner, setKoerner] = useState<{
		message: string;
		open: number;
		proposals: { name: string; forRows: string[]; reason: string }[];
		questions: { merchant: string; question: string; options: string[] }[];
	} | null>(null);

	/** Merchants the owner has settled, so Hr. Körner skips them. */
	const resolvedMerchants = () => {
		const names = new Set<string>();
		for (const row of allRows)
			if (picks[row.id]) names.add(row.merchantName ?? row.description);
		return [...names];
	};

	const consult = useMutation(
		orpc.categorisation.consult.mutationOptions({
			onSuccess: (result) => {
				setSession(result.sessionId);
				const { filled, reasons, proposals } = readConsultation(
					result.assignments,
				);
				setPicks((current) => {
					const next = { ...current };
					// Filled in, never ticked off: this is his reading, not the
					// owner's decision, and a choice they already made wins.
					for (const [id, categoryId] of Object.entries(filled))
						if (!next[id]) next[id] = categoryId;
					return next;
				});
				setGuesses((before) => ({ ...before, ...reasons }));
				setKoerner({
					message: result.message,
					open: result.openMerchants,
					proposals,
					questions: result.questions,
				});
			},
			onError: reportError,
		}),
	);

	/** Accepting a proposal creates the category and files everything it covers. */
	const acceptProposal = (proposal: {
		name: string;
		forRows: string[];
		reason: string;
	}) =>
		createCategory.mutate(
			{ name: proposal.name, kind: "expense" },
			{
				onSuccess: (category) => {
					toast.success(`Kategorie „${category.name}" angelegt`);
					setPickAll(proposal.forRows, category.id);
					dropProposal(proposal.name);
				},
			},
		);
	const dropProposal = (name: string) =>
		setKoerner((current) =>
			current
				? {
						...current,
						proposals: current.proposals.filter((row) => row.name !== name),
					}
				: current,
		);

	const apply = useMutation(
		orpc.categorisation.apply.mutationOptions({ onError: reportError }),
	);
	const [applyingKey, setApplyingKey] = useState<string | null>(null);

	/**
	 * Writes the picks of `rows` — one merchant, or everything open. The
	 * merchant each pick belongs to is read back from the database on the
	 * server; the request only names bookings and categories.
	 */
	const confirm = (rows: Row[], key: string, closeAfter: boolean) => {
		const ids = new Set(rows.map((row) => row.id));
		const sent = openPicks(picks, openIds).filter((pick) =>
			ids.has(pick.transactionId),
		);
		if (sent.length === 0) return;
		const merchants = new Set(
			rows
				.filter((row) => picks[row.id])
				.map((row) => row.merchantName)
				.filter((name): name is string => Boolean(name)),
		);
		setApplyingKey(key);
		apply.mutate(
			{
				picks: sent,
				rememberMerchants: rememberable.filter(
					(name) => remember[name] && merchants.has(name),
				),
			},
			{
				onSuccess: async (result) => {
					// Written: these bookings leave the review, and their picks
					// must never be sent a second time.
					setPicks((current) => {
						const next = { ...current };
						for (const pick of sent) delete next[pick.transactionId];
						return next;
					});
					await invalidate();
					toast.success(
						result.remembered > 0
							? `${result.updated} ${result.updated === 1 ? "Buchung" : "Buchungen"} zugeordnet · ${result.remembered} Händler gemerkt`
							: `${result.updated} ${result.updated === 1 ? "Buchung" : "Buchungen"} zugeordnet`,
					);
					if (closeAfter) onDone();
				},
				onSettled: () => setApplyingKey(null),
			},
		);
	};

	const sortedCategories = useMemo(
		() =>
			[...categories].sort((left, right) =>
				left.name.localeCompare(right.name, "de"),
			),
		[categories],
	);

	// Merchants the owner could choose to remember, taken from the rows they
	// actually picked a category for.
	const rememberable = useMemo(() => {
		const names = new Map<string, string>();
		for (const row of allRows) {
			const picked = picks[row.id];
			const name = row.merchantName;
			// Only worth offering where the app can act on it later, and only
			// where one merchant maps to exactly one chosen category.
			if (!picked || !name) continue;
			if (names.has(name) && names.get(name) !== picked) names.set(name, "");
			else names.set(name, picked);
		}
		return [...names.entries()]
			.filter(([, categoryId]) => categoryId)
			.map(([name]) => name);
	}, [picks, allRows]);

	const setPickAll = (ids: string[], categoryId: string) =>
		setPicks((current) => {
			const next = { ...current };
			for (const id of ids) {
				if (categoryId) next[id] = categoryId;
				else delete next[id];
			}
			return next;
		});

	const total = openPicks(picks, openIds).length;
	const sections: { key: string; title: string; hint: string; rows: Row[] }[] =
		[
			{
				key: "certain",
				title: "Schon entschieden",
				hint: "Beruht auf deinen Regeln, deinen Händlern oder darauf, wie du diesen Händler bisher immer zugeordnet hast.",
				rows: review.certain,
			},
			{
				key: "uncertain",
				title: "Bitte prüfen",
				hint: "Ein Vorschlag, aber kein eindeutiger: Hier hast du in der Vergangenheit unterschiedlich zugeordnet.",
				rows: review.uncertain,
			},
			{
				key: "unknown",
				title: "Selbst entscheiden",
				hint: "Hier gibt es nichts, woran Fortuna sich orientieren könnte. Ohne Auswahl bleibt die Buchung ohne Kategorie.",
				rows: review.unknown,
			},
		];

	if (allRows.length === 0)
		return (
			<div className="space-y-4 py-4 text-center">
				<p className="text-sm text-text-secondary">
					Alles zugeordnet — hier gibt es gerade nichts zu tun.
				</p>
				<Button variant="outline" className="max-sm:h-11" onClick={onDone}>
					Schließen
				</Button>
			</div>
		);

	const categorySelect = (
		props: {
			label: string;
			value: string;
			allPrefix?: boolean;
			onValue: (value: string) => void;
			onNew: () => void;
		} & { className?: string },
	) => (
		<NativeSelect
			aria-label={props.label}
			value={props.value}
			onChange={(event) => {
				const { value } = event.currentTarget;
				if (value === NEW_CATEGORY) return props.onNew();
				props.onValue(value);
			}}
			className={cn(!props.value && "text-text-muted", props.className)}
		>
			<option value="">Nicht zuordnen</option>
			{sortedCategories.map((category) => (
				<option key={category.id} value={category.id}>
					{category.name}
				</option>
			))}
			<option value={NEW_CATEGORY}>＋ Neue Kategorie …</option>
		</NativeSelect>
	);

	const newCategoryForm = (key: string) =>
		creatingFor?.key === key ? (
			<form
				className="flex gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					const name = new FormData(event.currentTarget)
						.get("name")
						?.toString()
						.trim();
					if (!name) return setCreatingFor(null);
					createFor(name);
				}}
			>
				<Input
					name="name"
					autoFocus
					placeholder="z. B. Vereinsbeitrag"
					aria-label="Name der neuen Kategorie"
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.stopPropagation();
							setCreatingFor(null);
						}
					}}
				/>
				<Button
					type="submit"
					className="max-sm:h-11"
					disabled={createCategory.isPending}
					aria-label="Kategorie anlegen"
				>
					<Check />
				</Button>
			</form>
		) : null;

	return (
		<div className="space-y-5">
			{koerner ? (
				<KoernerPanel
					koerner={koerner}
					pending={consult.isPending}
					creating={createCategory.isPending}
					onContinue={() =>
						consult.mutate({
							sessionId: session,
							resolved: resolvedMerchants(),
						})
					}
					onAnswer={(merchant, answer) =>
						consult.mutate({
							sessionId: session,
							merchant,
							answer,
							resolved: resolvedMerchants(),
						})
					}
					onAccept={acceptProposal}
					onDecline={dropProposal}
				/>
			) : null}
			{sections.map((section) =>
				section.rows.length === 0 ? null : (
					<section key={section.key} className="space-y-2">
						<div className="flex flex-wrap items-baseline justify-between gap-2">
							<h3 className="text-sm font-semibold text-text">
								{section.title}{" "}
								<span className="text-text-muted">({section.rows.length})</span>
							</h3>
							{section.key === "certain" ? (
								<Button
									variant="ghost"
									size="sm"
									onClick={() =>
										setPicks((current) => {
											const next = { ...current };
											const allPicked = section.rows.every(
												(row) => next[row.id],
											);
											for (const row of section.rows) {
												if (allPicked) delete next[row.id];
												else if (row.suggestion)
													next[row.id] = row.suggestion.categoryId;
											}
											return next;
										})
									}
								>
									Alle an/ab
								</Button>
							) : null}
						</div>
						<p className="text-xs text-text-muted">{section.hint}</p>
						{section.key === "unknown" && copilot.connected && !koerner ? (
							<Button
								variant="outline"
								className="max-sm:h-11"
								disabled={consult.isPending}
								onClick={() =>
									consult.mutate({ resolved: resolvedMerchants() })
								}
							>
								<Sparkles />
								{consult.isPending
									? "Hr. Körner sieht sich das an …"
									: "Mit Hr. Körner durchgehen"}
							</Button>
						) : null}
						<ul className="space-y-2">
							{groupByMerchant(section.rows).map((merchant) => (
								<MerchantCard
									key={merchant.key}
									merchant={merchant}
									picks={picks}
									guesses={guesses}
									expanded={Boolean(expanded[merchant.key])}
									onToggle={() =>
										setExpanded((current) => ({
											...current,
											[merchant.key]: !current[merchant.key],
										}))
									}
									remembered={
										merchant.rows[0].merchantName
											? (remember[merchant.rows[0].merchantName] ?? false)
											: false
									}
									canRemember={Boolean(
										merchant.rows[0].merchantName &&
											rememberable.includes(merchant.rows[0].merchantName),
									)}
									onRemember={(checked) => {
										const name = merchant.rows[0].merchantName as string;
										setRemember((current) => ({
											...current,
											[name]: checked,
										}));
									}}
									applying={applyingKey === merchant.key}
									busy={apply.isPending}
									onConfirm={() => confirm(merchant.rows, merchant.key, false)}
									groupSelect={categorySelect({
										label:
											merchant.rows.length === 1
												? `Kategorie für ${merchant.label}`
												: `Kategorie für alle ${merchant.rows.length} Buchungen von ${merchant.label}`,
										value: sharedPick(merchant.rows, picks),
										onValue: (value) =>
											setPickAll(
												merchant.rows.map((row) => row.id),
												value,
											),
										onNew: () =>
											setCreatingFor({
												key: merchant.key,
												rowIds: merchant.rows.map((row) => row.id),
												kind:
													merchant.rows[0].amountMinor < 0
														? "expense"
														: "income",
											}),
										className: "min-w-0 flex-1",
									})}
									groupCreate={newCategoryForm(merchant.key)}
									rowSelect={(row) =>
										creatingFor?.key === row.id
											? newCategoryForm(row.id)
											: categorySelect({
													label: `Kategorie für ${row.merchantName ?? row.description} am ${row.bookingDate}`,
													value: picks[row.id] ?? "",
													onValue: (value) => setPickAll([row.id], value),
													onNew: () =>
														setCreatingFor({
															key: row.id,
															rowIds: [row.id],
															kind: row.amountMinor < 0 ? "expense" : "income",
														}),
												})
									}
								/>
							))}
						</ul>
					</section>
				),
			)}
			{review.remaining > 0 ? (
				<p className="text-xs text-text-muted">
					Weitere {review.remaining} Buchungen ohne Kategorie stehen noch an —
					sie rücken nach dem Bestätigen nach.
				</p>
			) : null}
			{/* Sticky, so confirming everything never means scrolling past
			    every merchant first. */}
			<div className="sticky -bottom-5 z-10 -mx-5 -mb-5 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-5 py-3 max-sm:-bottom-4 max-sm:-mx-4 max-sm:-mb-4 max-sm:px-4 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
				<p className="text-xs text-text-secondary max-sm:w-full">
					{total === 0
						? "Nichts ausgewählt — es wird nichts geändert."
						: "Nicht Ausgewähltes bleibt, wie es ist."}
				</p>
				<div className="flex gap-2 max-sm:w-full">
					<Button variant="outline" className="max-sm:h-11" onClick={onDone}>
						Schließen
					</Button>
					<Button
						className="max-sm:h-11 max-sm:flex-1"
						disabled={total === 0 || apply.isPending}
						onClick={() => confirm(allRows, "__all__", true)}
					>
						{applyingKey === "__all__"
							? "Wird gespeichert …"
							: `Alle bestätigen (${total})`}
					</Button>
				</div>
			</div>
		</div>
	);
}

/**
 * One merchant as one card: what it is, the proposal and its evidence, one
 * category for all of its bookings and a large "Übernehmen" that writes just
 * this merchant. The single bookings are one tap away.
 */
function MerchantCard({
	merchant,
	picks,
	guesses,
	expanded,
	onToggle,
	remembered,
	canRemember,
	onRemember,
	applying,
	busy,
	onConfirm,
	groupSelect,
	groupCreate,
	rowSelect,
}: {
	merchant: MerchantGroup<Row>;
	picks: Record<string, string>;
	guesses: Record<string, string>;
	expanded: boolean;
	onToggle: () => void;
	remembered: boolean;
	canRemember: boolean;
	onRemember: (checked: boolean) => void;
	applying: boolean;
	busy: boolean;
	onConfirm: () => void;
	groupSelect: React.ReactNode;
	groupCreate: React.ReactNode;
	rowSelect: (row: Row) => React.ReactNode;
}) {
	const f = useFormat();
	const first = merchant.rows[0];
	const single = merchant.rows.length === 1;
	const picked = merchant.rows.filter((row) => picks[row.id]).length;
	// The evidence is shown once when every booking rests on the same one.
	const suggestion = merchant.rows.every(
		(row) =>
			row.suggestion?.categoryId === first.suggestion?.categoryId &&
			row.suggestion?.source === first.suggestion?.source,
	)
		? first.suggestion
		: null;
	const guess = merchant.rows.map((row) => guesses[row.id]).find(Boolean);

	return (
		<li className="space-y-3 rounded-md border border-border p-3">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="break-words text-sm font-medium text-text">
						{merchant.label}
					</p>
					<p className="text-xs text-text-muted">
						{single
							? `${f.date(first.bookingDate)}${first.accountName ? ` · ${first.accountName}` : ""}`
							: `${merchant.rows.length} Buchungen`}
					</p>
				</div>
				<Money
					amountMinor={merchant.sumMinor}
					currency={first.currency}
					className="shrink-0 text-sm"
					tone={merchant.sumMinor > 0 ? "positive" : "default"}
				/>
			</div>
			{single && first.note ? (
				<p className="break-words text-xs text-text-secondary">{first.note}</p>
			) : null}
			{suggestion ? (
				<p className="flex flex-wrap items-center gap-2 text-xs">
					<Badge variant={suggestion.certain ? "positive" : "warning"}>
						{SOURCE_LABELS[suggestion.source] ?? "Vorschlag"}
					</Badge>
					<span className="text-text-secondary">{suggestion.evidence}</span>
				</p>
			) : null}
			{guess ? (
				<p className="flex flex-wrap items-center gap-2 text-xs">
					<Badge variant="info">Vermutung</Badge>
					<span className="text-text-secondary">
						{guess} — Hr. Körner kennt nur den Namen, nicht die Buchung.
					</span>
				</p>
			) : null}
			{groupCreate ?? (
				<div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
					{groupSelect}
					<Button
						className="shrink-0 max-sm:h-11 max-sm:w-full"
						disabled={picked === 0 || busy}
						onClick={onConfirm}
					>
						<Check />
						{applying
							? "Wird gespeichert …"
							: picked > 1
								? `${picked} übernehmen`
								: "Übernehmen"}
					</Button>
				</div>
			)}
			<div className="flex flex-wrap items-center justify-between gap-2">
				{canRemember ? (
					<label className="flex min-h-9 items-center gap-2 text-xs text-text-secondary">
						<input
							type="checkbox"
							className="size-4 accent-brand"
							checked={remembered}
							onChange={(event) => {
								// Read before any updater runs: React has already
								// nulled currentTarget by then.
								const { checked } = event.currentTarget;
								onRemember(checked);
							}}
						/>
						{first.merchantName} künftig immer so
					</label>
				) : (
					<span />
				)}
				{single ? null : (
					<button
						type="button"
						aria-expanded={expanded}
						onClick={onToggle}
						className="inline-flex min-h-9 items-center gap-1 text-xs text-brand hover:underline"
					>
						{expanded ? "Einzeln ausblenden" : "Einzeln ansehen"}
						<ChevronDown
							className={cn(
								"size-3.5 transition-transform",
								expanded && "rotate-180",
							)}
						/>
					</button>
				)}
			</div>
			{!single && expanded ? (
				<ul className="divide-y divide-border rounded-md border border-border">
					{merchant.rows.map((row) => (
						<li
							key={row.id}
							className="grid gap-2 p-3 sm:grid-cols-[1fr_16rem] sm:items-center"
						>
							<div className="min-w-0">
								<p className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
									<span className="text-text-secondary">
										{f.date(row.bookingDate)}
										{row.accountName ? ` · ${row.accountName}` : ""}
									</span>
									<Money
										amountMinor={row.amountMinor}
										currency={row.currency}
										className="text-xs"
									/>
								</p>
								{row.description !== merchant.label ? (
									<p className="break-words text-xs text-text-muted">
										{row.description}
									</p>
								) : null}
								{row.note ? (
									<p className="break-words text-xs text-text-secondary">
										{row.note}
									</p>
								) : null}
							</div>
							{rowSelect(row)}
						</li>
					))}
				</ul>
			) : null}
		</li>
	);
}

function KoernerPanel({
	koerner,
	pending,
	creating,
	onContinue,
	onAnswer,
	onAccept,
	onDecline,
}: {
	koerner: {
		message: string;
		open: number;
		proposals: { name: string; forRows: string[]; reason: string }[];
		questions: { merchant: string; question: string; options: string[] }[];
	};
	pending: boolean;
	creating: boolean;
	onContinue: () => void;
	onAnswer: (merchant: string, answer: string) => void;
	onAccept: (proposal: {
		name: string;
		forRows: string[];
		reason: string;
	}) => void;
	onDecline: (name: string) => void;
}) {
	return (
		<section className="space-y-3 rounded-md border border-brand-subtle bg-brand-subtle/30 p-3">
			<p className="text-sm text-text">
				<strong>Hr. Körner:</strong> {koerner.message}
			</p>
			{koerner.questions.length === 0 && koerner.open > 0 ? (
				<Button
					variant="outline"
					className="max-sm:h-11"
					disabled={pending}
					onClick={onContinue}
				>
					{pending
						? "Hr. Körner sieht sich das an …"
						: `Weitermachen — noch ${koerner.open} offen`}
				</Button>
			) : null}
			{koerner.proposals.length ? (
				<div className="space-y-2">
					<p className="label-caps">Neue Kategorien vorgeschlagen</p>
					{koerner.proposals.map((proposal) => (
						<div
							key={proposal.name}
							className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-surface px-3 py-2"
						>
							<p className="min-w-0 break-words text-sm">
								<strong>{proposal.name}</strong>{" "}
								<span className="text-text-muted">
									für {proposal.forRows.length}{" "}
									{proposal.forRows.length === 1 ? "Buchung" : "Buchungen"}
									{proposal.reason ? ` · ${proposal.reason}` : ""}
								</span>
							</p>
							<div className="flex gap-1">
								<Button
									size="sm"
									className="max-sm:h-11"
									disabled={creating}
									onClick={() => onAccept(proposal)}
								>
									Anlegen
								</Button>
								<Button
									variant="ghost"
									size="sm"
									className="max-sm:h-11"
									onClick={() => onDecline(proposal.name)}
								>
									Nein
								</Button>
							</div>
						</div>
					))}
				</div>
			) : null}
			{koerner.questions.map((question) => (
				<div
					key={question.merchant}
					className="space-y-2 rounded border border-border bg-surface px-3 py-2"
				>
					<p className="break-words text-sm text-text">{question.question}</p>
					<form
						className="flex flex-wrap items-center gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							const answer = new FormData(event.currentTarget)
								.get("answer")
								?.toString()
								.trim();
							if (!answer) return;
							onAnswer(question.merchant, answer);
						}}
					>
						{question.options.map((option) => (
							<Button
								key={option}
								type="button"
								variant="outline"
								size="sm"
								className="max-sm:h-11"
								disabled={pending}
								onClick={() => onAnswer(question.merchant, option)}
							>
								{option}
							</Button>
						))}
						<Input
							name="answer"
							placeholder="oder selbst antworten …"
							aria-label={`Antwort zu ${question.merchant}`}
							className="min-w-0 flex-1 sm:w-52 sm:flex-none"
						/>
						<Button
							type="submit"
							size="sm"
							className="max-sm:h-11"
							disabled={pending}
						>
							{pending ? "…" : "Antworten"}
						</Button>
					</form>
				</div>
			))}
		</section>
	);
}
