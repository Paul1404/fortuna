import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Money, useFormat } from "@/lib/format";
import { parseAmountInput, toAmountInput } from "@/lib/forms";
import { cn } from "@/lib/utils";

// Sheet primitives: a section header with subtotal, an inline-editable
// amount cell, and the pieces of the tap-first rows: a row that opens an
// action sheet, the actions in it, a large amount input and a folded group
// for what is settled. Every value change still ends in a dated history row
// written by the caller.

export function SectionHeader({
	title,
	count,
	subtotalMinor,
	currency,
	action,
	onRename,
}: {
	title: string;
	count: number;
	subtotalMinor: number;
	currency?: string;
	action?: React.ReactNode;
	onRename?: (name: string) => void;
}) {
	const [editing, setEditing] = useState(false);
	return (
		<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border bg-surface-sunken/60 px-4 py-1 sm:py-1.5">
			<div className="flex min-w-0 items-center gap-2">
				{editing && onRename ? (
					<form
						onSubmit={(e) => {
							e.preventDefault();
							const v = String(
								new FormData(e.currentTarget).get("name") ?? "",
							).trim();
							if (v && v !== title) onRename(v);
							setEditing(false);
						}}
					>
						<Input
							name="name"
							aria-label={`Abschnitt „${title}" umbenennen`}
							defaultValue={title}
							autoFocus
							enterKeyHint="done"
							className="h-11 w-56 text-base sm:h-7 sm:w-48 sm:text-xs"
							onBlur={() => setEditing(false)}
						/>
					</form>
				) : (
					<button
						type="button"
						className={cn(
							"min-h-11 break-words text-left text-xs font-semibold uppercase tracking-[0.08em] text-text sm:min-h-0",
							onRename &&
								"underline decoration-transparent decoration-dotted underline-offset-4 hover:decoration-border-strong",
						)}
						onClick={() => onRename && setEditing(true)}
						title={onRename ? "Bereich umbenennen" : undefined}
					>
						{title}
					</button>
				)}
				<span className="text-[11px] text-text-muted">{count}</span>
			</div>
			<div className="flex flex-wrap items-center gap-3">
				{action}
				<Money
					amountMinor={subtotalMinor}
					currency={currency}
					className="text-xs"
				/>
			</div>
		</div>
	);
}

export function EditableAmount({
	valueMinor,
	currency,
	onSave,
	className,
	tone = "default",
	ariaLabel,
}: {
	valueMinor: number;
	currency?: string;
	onSave: (minor: number) => Promise<unknown> | undefined;
	className?: string;
	tone?: "default" | "negative";
	ariaLabel: string;
}) {
	const [editing, setEditing] = useState(false);
	const [text, setText] = useState("");
	const ref = useRef<HTMLInputElement>(null);
	const f = useFormat();
	useEffect(() => {
		if (editing) ref.current?.select();
	}, [editing]);
	if (!editing) {
		return (
			<button
				type="button"
				aria-label={`${ariaLabel}: ${f.money(valueMinor, currency)}. Zum Bearbeiten auswählen`}
				onClick={() => {
					setText(toAmountInput(Math.abs(valueMinor)));
					setEditing(true);
				}}
				className={cn(
					"amount min-h-11 rounded-sm px-1 font-semibold underline decoration-border-strong decoration-dotted underline-offset-4 hover:bg-surface-sunken sm:min-h-0",
					tone === "negative" && "text-negative",
					className,
				)}
			>
				{f.money(valueMinor, currency)}
			</button>
		);
	}
	const commit = async () => {
		const parsed = parseAmountInput(text);
		setEditing(false);
		if (parsed === null || parsed === Math.abs(valueMinor)) return;
		await onSave(parsed);
	};
	return (
		<input
			ref={ref}
			value={text}
			onChange={(e) => setText(e.target.value)}
			onBlur={commit}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					commit();
				}
				if (e.key === "Escape") setEditing(false);
			}}
			inputMode="decimal"
			enterKeyHint="done"
			autoComplete="off"
			aria-label={ariaLabel}
			className={cn(
				"amount h-11 w-32 rounded-sm border border-focus bg-surface px-1.5 text-right text-base outline-none sm:h-7 sm:w-28 sm:text-sm",
				className,
			)}
		/>
	);
}

export function InlineAddRow({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				// On a phone every field takes the full width: side by side at
				// fixed widths they wrapped into a ragged, half-empty grid.
				"flex flex-wrap items-end gap-2 border-t border-dashed border-border bg-surface-sunken/40 px-4 py-2 max-sm:flex-col max-sm:items-stretch max-sm:gap-3 max-sm:py-3 max-sm:[&_input]:w-full max-sm:[&_select]:w-full",
				className,
			)}
		>
			{children}
		</div>
	);
}

export function annualisedReturn(
	costMinor: number | null,
	valueMinor: number,
	days: number | null,
): number | null {
	if (!costMinor || costMinor <= 0 || !days || days < 30 || valueMinor <= 0)
		return null;
	return ((valueMinor / costMinor) ** (365 / days) - 1) * 100;
}

/**
 * The summary line and actions above one sheet, where a page with several
 * sheets as tabs cannot give each its own page header.
 */
export function SheetBar({
	subtitle,
	actions,
}: {
	subtitle: React.ReactNode;
	actions?: React.ReactNode;
}) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-3">
			<p className="min-w-0 text-sm text-text-secondary">{subtitle}</p>
			{actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
		</div>
	);
}

/**
 * One line of a tap-first sheet: the whole row is a single button that opens
 * the item's actions, so a phone needs no hover and no small target. Text
 * wraps; the amount and its detail stay at the end.
 */
export function SheetRow({
	title,
	meta,
	badges,
	amount,
	amountDetail,
	progress,
	onOpen,
	selected,
	muted,
	label,
}: {
	title: React.ReactNode;
	meta?: React.ReactNode;
	badges?: React.ReactNode;
	amount: React.ReactNode;
	amountDetail?: React.ReactNode;
	/** A computed share, 0 to 1, drawn as a thin bar under the text. */
	progress?: number | null;
	onOpen: () => void;
	selected?: boolean;
	muted?: boolean;
	/** Accessible name, e.g. "Waschmaschine, 200,00 € offen". */
	label: string;
}) {
	return (
		<button
			type="button"
			onClick={onOpen}
			aria-label={label}
			aria-haspopup="dialog"
			className={cn(
				"flex min-h-14 w-full items-center gap-3 border-t border-border px-4 py-3 text-left outline-none transition-colors first:border-t-0 hover:bg-surface-sunken/50 focus-visible:bg-surface-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand",
				// Selection only means something beside the history panel.
				selected && "xl:bg-brand-subtle/60",
			)}
		>
			<span className="min-w-0 flex-1">
				<span
					className={cn(
						"block break-words text-sm font-medium",
						muted ? "text-text-secondary" : "text-text",
					)}
				>
					{title}
				</span>
				{meta ? (
					<span className="mt-0.5 block break-words text-xs text-text-muted">
						{meta}
					</span>
				) : null}
				{badges ? (
					<span className="mt-1 flex flex-wrap gap-1">{badges}</span>
				) : null}
				{progress !== null && progress !== undefined ? (
					<span
						className="mt-2 block h-1 w-full max-w-48 overflow-hidden rounded-full bg-border"
						aria-hidden
					>
						<span
							className="block h-full rounded-full bg-brand"
							style={{ width: `${Math.round(progress * 100)}%` }}
						/>
					</span>
				) : null}
			</span>
			<span className="shrink-0 text-right">
				<span className={cn("block text-sm", muted && "opacity-70")}>
					{amount}
				</span>
				{amountDetail ? (
					<span className="mt-0.5 block text-[11px] text-text-muted">
						{amountDetail}
					</span>
				) : null}
			</span>
			<ChevronRight className="size-4 shrink-0 text-text-muted" aria-hidden />
		</button>
	);
}

/** The settled items of a sheet, folded away under "Erledigt". */
export function SettledGroup({
	count,
	children,
	label = "Erledigt",
}: {
	count: number;
	children: React.ReactNode;
	label?: string;
}) {
	const [open, setOpen] = useState(false);
	if (count === 0) return null;
	return (
		<div className="surface overflow-hidden">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
				className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm font-medium text-text-secondary outline-none hover:bg-surface-sunken/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
			>
				<span>
					{label} <span className="text-text-muted">{count}</span>
				</span>
				<ChevronDown
					className={cn("size-4 transition-transform", open && "rotate-180")}
					aria-hidden
				/>
			</button>
			{open ? <div className="border-t border-border">{children}</div> : null}
		</div>
	);
}

/** One entry of an action sheet: a full-width, finger-sized choice. */
export function ActionItem({
	icon: Icon,
	label,
	detail,
	onClick,
	tone = "default",
	disabled,
}: {
	icon: LucideIcon;
	label: string;
	detail?: React.ReactNode;
	onClick: () => void;
	tone?: "default" | "primary";
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={cn(
				"flex min-h-14 w-full items-center gap-3 rounded-control border px-3 py-2.5 text-left outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-50",
				tone === "primary"
					? "border-brand bg-brand-subtle/50 hover:bg-brand-subtle"
					: "border-border-strong bg-surface hover:bg-surface-sunken",
			)}
		>
			<span
				className={cn(
					"grid size-9 shrink-0 place-items-center rounded-full",
					tone === "primary"
						? "bg-brand text-text-inverse"
						: "bg-surface-sunken text-text-secondary",
				)}
			>
				<Icon className="size-4" aria-hidden />
			</span>
			<span className="min-w-0 flex-1">
				<span className="block text-sm font-medium text-text">{label}</span>
				{detail ? (
					<span className="block break-words text-xs text-text-muted">
						{detail}
					</span>
				) : null}
			</span>
			<ChevronRight className="size-4 shrink-0 text-text-muted" aria-hidden />
		</button>
	);
}

/**
 * The amount field of a quick entry: large, numeric keypad, focused on open,
 * so the first thing the owner types is the number.
 */
export function AmountInput({
	id,
	value,
	onChange,
	label,
	currency,
	autoFocus = true,
	name = "amount",
}: {
	id: string;
	value: string;
	onChange: (value: string) => void;
	label: string;
	currency: string;
	autoFocus?: boolean;
	name?: string;
}) {
	return (
		<div className="space-y-1.5">
			<label
				htmlFor={id}
				className="block text-xs font-medium text-text-secondary"
			>
				{label}
			</label>
			<div className="relative">
				<Input
					id={id}
					name={name}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					// A prefilled figure is replaced by typing, not appended to.
					onFocus={(event) => event.currentTarget.select()}
					inputMode="decimal"
					enterKeyHint="done"
					autoComplete="off"
					placeholder="0,00"
					autoFocus={autoFocus}
					required
					className="amount h-14 pr-14 text-right text-2xl font-semibold sm:h-12 sm:text-xl"
				/>
				<span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-text-muted">
					{currency}
				</span>
			</div>
		</div>
	);
}
