import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useState } from "react";
import { Money } from "@/lib/format";
import { ALL_NAV_ITEMS, PALETTE_ONLY_ITEMS } from "@/lib/navigation";
import { orpc } from "@/lib/orpc";

const PAGE_ITEMS = [...ALL_NAV_ITEMS, ...PALETTE_ONLY_ITEMS];

const KIND_LABEL: Record<string, string> = {
	transaction: "Transaktionen",
	account: "Konten",
	asset: "Sachwerte",
	liability: "Verbindlichkeiten",
	receivable: "Forderungen",
	optimization: "Sparmissionen",
	merchant: "Händler",
	category: "Kategorien",
	recurring: "Fixkosten",
	contract: "Verträge",
};

export function CommandPalette({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [q, setQ] = useState("");
	const navigate = useNavigate();
	const { data } = useQuery({
		...orpc.search.queryOptions({ input: { q, limit: 6 } }),
		enabled: open && q.trim().length > 0,
	});

	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				onOpenChange(!open);
			}
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, onOpenChange]);

	useEffect(() => {
		if (!open) setQ("");
	}, [open]);

	function go(to: string, search?: Record<string, unknown>) {
		onOpenChange(false);
		navigate({ to, search: search as never });
	}

	function hitTarget(
		kind: string,
		id: string,
	): [string, Record<string, unknown>?] {
		switch (kind) {
			case "transaction":
				return ["/transactions", { highlight: id }];
			case "account":
				return [`/accounts/${id}`];
			case "asset":
				return [`/assets/${id}`];
			case "liability":
				return ["/debts", { tab: "liabilities", highlight: id }];
			case "receivable":
				return ["/debts", { highlight: id }];
			case "optimization":
				return ["/fixed-costs", { mission: id }];
			case "merchant":
				return ["/transactions", { merchantId: id }];
			case "category":
				return ["/transactions", { categoryId: id }];
			case "recurring":
				return ["/fixed-costs", { highlight: id }];
			case "contract":
				return ["/fixed-costs", { contract: id }];
			default:
				return ["/"];
		}
	}

	const grouped = new Map<string, NonNullable<typeof data>>();
	for (const hit of data ?? [])
		grouped.set(hit.kind, [...(grouped.get(hit.kind) ?? []), hit]);
	const navMatches = q.trim()
		? PAGE_ITEMS.filter((n) => n.label.toLowerCase().includes(q.toLowerCase()))
		: PAGE_ITEMS;

	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30" />
				<DialogPrimitive.Content className="fixed top-[12vh] left-1/2 z-50 w-[calc(100%-1.5rem)] max-sm:top-[calc(env(safe-area-inset-top)+0.75rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-md border border-border bg-surface shadow-overlay outline-none">
					<DialogPrimitive.Title className="sr-only">
						Suchen
					</DialogPrimitive.Title>
					<DialogPrimitive.Description className="sr-only">
						Transaktionen, Konten, Sachwerte, Händler und Kategorien durchsuchen
						oder direkt zu einer Seite wechseln.
					</DialogPrimitive.Description>
					<Command shouldFilter={false} label="Globale Suche">
						<div className="border-b border-border px-3">
							<Command.Input
								value={q}
								onValueChange={setQ}
								placeholder="Transaktionen, Konten, Sachwerte, Händler durchsuchen…"
								className="h-12 w-full bg-transparent text-base outline-none sm:h-11 sm:text-sm placeholder:text-text-muted"
							/>
						</div>
						<Command.List className="max-h-[min(50vh,calc(var(--app-vvh,100dvh)-7rem))] overflow-y-auto overscroll-contain p-2 max-sm:max-h-[calc(var(--app-vvh,100dvh)-7rem)]">
							<Command.Empty className="px-2 py-6 text-center text-xs text-text-muted">
								{q.trim() ? "Keine Treffer" : "Suchbegriff eingeben"}
							</Command.Empty>
							{Array.from(grouped.entries()).map(([kind, hits]) => (
								<Command.Group
									key={kind}
									heading={KIND_LABEL[kind] ?? kind}
									className="[&_[cmdk-group-heading]]:label-caps [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
								>
									{hits.map((hit) => (
										<Command.Item
											key={`${hit.kind}-${hit.id}`}
											value={`${hit.kind}-${hit.id}`}
											onSelect={() => {
												const [to, search] = hitTarget(hit.kind, hit.id);
												go(to, search);
											}}
											className="flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-sm pointer-coarse:min-h-11 data-[selected=true]:bg-brand-subtle"
										>
											<span className="min-w-0">
												<span className="block break-words text-text">
													{hit.title}
												</span>
												{hit.subtitle ? (
													<span className="block break-words text-[11px] text-text-muted">
														{hit.subtitle}
													</span>
												) : null}
											</span>
											{hit.amountMinor !== undefined ? (
												<Money
													amountMinor={hit.amountMinor}
													currency={hit.currency}
													tone={hit.kind === "transaction" ? "auto" : "default"}
													className="text-xs"
												/>
											) : null}
										</Command.Item>
									))}
								</Command.Group>
							))}
							{navMatches.length > 0 ? (
								<Command.Group
									heading="Gehe zu"
									className="[&_[cmdk-group-heading]]:label-caps [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
								>
									{navMatches.map((n) => (
										<Command.Item
											key={`${n.href}-${n.label}`}
											value={`nav-${n.href}-${n.label}`}
											onSelect={() => go(n.href)}
											className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm pointer-coarse:min-h-11 data-[selected=true]:bg-brand-subtle"
										>
											<n.icon className="size-4 text-text-muted" />
											{n.label}
										</Command.Item>
									))}
								</Command.Group>
							) : null}
						</Command.List>
					</Command>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
