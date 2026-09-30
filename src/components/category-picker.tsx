import { Check, Plus, Search } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pickerCategories } from "@/lib/recent-categories";
import { cn } from "@/lib/utils";

type PickerCategory = { id: string; name: string; parentId: string | null };

/**
 * Category first, one tap each: the recent categories as large chips, then a
 * searchable list, and "Neue Kategorie" for a name that does not exist yet.
 * Choosing is the decision — the caller saves on `onPick` — so a recent
 * category is two taps from the list: the booking, then the chip.
 */
export function CategoryPicker({
	categories,
	value,
	recent,
	disabled,
	creating,
	onPick,
	onCreate,
}: {
	categories: PickerCategory[];
	value: string | null;
	recent: string[];
	disabled?: boolean;
	creating?: boolean;
	onPick: (categoryId: string | null) => void;
	onCreate: (name: string) => void;
}) {
	const [query, setQuery] = useState("");
	const [naming, setNaming] = useState(false);
	const [newName, setNewName] = useState("");
	const searchId = useId();
	const view = pickerCategories(categories, recent, query);
	const typed = query.trim();

	return (
		<div className="space-y-3">
			{view.recent.length ? (
				<div>
					<p className="label-caps mb-1.5">Zuletzt verwendet</p>
					<div className="flex flex-wrap gap-2">
						{view.recent.map((category) => (
							<button
								key={category.id}
								type="button"
								disabled={disabled}
								onClick={() => onPick(category.id)}
								aria-pressed={category.id === value}
								className={cn(
									"inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-control border px-3 text-left text-sm transition-colors sm:min-h-8",
									category.id === value
										? "border-brand bg-brand-subtle text-brand"
										: "border-border-strong bg-surface text-text hover:border-brand hover:text-brand",
								)}
							>
								{category.id === value ? (
									<Check className="size-3.5 shrink-0" />
								) : null}
								<span className="min-w-0 break-words">{category.name}</span>
							</button>
						))}
					</div>
				</div>
			) : null}
			<div className="relative">
				<label htmlFor={searchId} className="sr-only">
					Kategorie suchen
				</label>
				<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-muted" />
				<Input
					id={searchId}
					type="search"
					enterKeyHint="done"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={(event) => {
						// Enter takes the single remaining match instead of
						// submitting the surrounding form with nothing chosen.
						if (event.key !== "Enter") return;
						event.preventDefault();
						if (view.matches.length === 1) onPick(view.matches[0].id);
						else if (typed && !view.exact) onCreate(typed);
					}}
					placeholder="Kategorie suchen …"
					className="pl-8"
					disabled={disabled}
				/>
			</div>
			<ul
				className="max-h-64 divide-y divide-border overflow-y-auto overscroll-contain rounded-md border border-border"
				aria-label="Kategorien"
			>
				{typed ? null : (
					<PickerOption
						label="Nicht kategorisiert"
						muted
						selected={value === null}
						disabled={disabled}
						onClick={() => onPick(null)}
					/>
				)}
				{view.matches.map((category) => (
					<PickerOption
						key={category.id}
						label={category.name}
						indent={Boolean(category.parentId) && !typed}
						selected={category.id === value}
						disabled={disabled}
						onClick={() => onPick(category.id)}
					/>
				))}
				{typed && view.matches.length === 0 ? (
					<li className="px-3 py-2.5 text-sm text-text-muted">
						Keine Kategorie heißt so.
					</li>
				) : null}
			</ul>
			{naming && !typed ? (
				// Not a <form>: the picker may sit beside a booking's own form,
				// and a nested form is invalid and submits the outer one.
				<div className="flex gap-2">
					<Input
						autoFocus
						maxLength={120}
						value={newName}
						onChange={(event) => setNewName(event.target.value)}
						placeholder="z. B. Vereinsbeitrag"
						aria-label="Name der neuen Kategorie"
						enterKeyHint="done"
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								event.stopPropagation();
								setNaming(false);
							}
							if (event.key === "Enter") {
								event.preventDefault();
								if (newName.trim()) onCreate(newName.trim());
							}
						}}
					/>
					<Button
						type="button"
						disabled={creating || !newName.trim()}
						className="max-sm:h-11"
						onClick={() => onCreate(newName.trim())}
					>
						Anlegen
					</Button>
				</div>
			) : (
				<Button
					type="button"
					variant="ghost"
					disabled={disabled || creating}
					className="max-sm:h-11"
					onClick={() => (typed ? onCreate(typed) : setNaming(true))}
				>
					<Plus />
					{typed && !view.exact
						? `Neue Kategorie „${typed}"`
						: "Neue Kategorie"}
				</Button>
			)}
		</div>
	);
}

function PickerOption({
	label,
	selected,
	indent,
	muted,
	disabled,
	onClick,
}: {
	label: string;
	selected: boolean;
	indent?: boolean;
	muted?: boolean;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<li>
			<button
				type="button"
				disabled={disabled}
				onClick={onClick}
				aria-pressed={selected}
				className={cn(
					"flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-sunken sm:min-h-9",
					indent && "pl-7",
					muted && "text-text-muted",
					selected && "bg-brand-subtle font-medium text-brand",
				)}
			>
				<span className="min-w-0 break-words">{label}</span>
				{selected ? <Check className="size-4 shrink-0" /> : null}
			</button>
		</li>
	);
}
