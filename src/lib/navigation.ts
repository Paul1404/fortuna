import {
	ArrowLeftRight,
	CalendarClock,
	FileCheck2,
	Gem,
	HandCoins,
	History,
	LineChart,
	type LucideIcon,
	MessageCircleMore,
	NotebookPen,
	Plug,
	Scale,
	Settings,
	Sprout,
	Wallet,
} from "lucide-react";

export type NavItem = {
	href: string;
	label: string;
	icon: LucideIcon;
	exact?: boolean;
};
export type NavGroup = { label: string | null; items: NavItem[] };

/**
 * The menu as the owner decided it on 27.09.2026: the desk, then what there
 * is, what moves, and what to do with it. Übersicht and Rückblick merged into
 * Vermögen, Wiederkehrend, Verträge and Optimierung into Fixkosten, Bargeld
 * into Konten, Forderungen and Verbindlichkeiten into one page, and Import &
 * Export and Verbindungen into Einstellungen › Datenquellen. Their old
 * routes redirect.
 */
export const NAV_GROUPS: NavGroup[] = [
	{
		label: null,
		items: [
			// The desk embeds the conversation and works the open findings, so
			// "Gespräch" and the findings history are reached from there and from
			// the search, not from the menu (PALETTE_ONLY_ITEMS).
			{ href: "/", label: "Hr. Körner", icon: NotebookPen, exact: true },
			{ href: "/net-worth", label: "Vermögen", icon: Scale },
			{ href: "/accounts", label: "Konten & Depots", icon: Wallet },
			{ href: "/assets", label: "Sachwerte", icon: Gem },
			{ href: "/debts", label: "Forderungen & Schulden", icon: HandCoins },
			{ href: "/transactions", label: "Umsätze", icon: ArrowLeftRight },
			{ href: "/cashflow", label: "Zahlungsfluss", icon: LineChart },
			{ href: "/fixed-costs", label: "Fixkosten", icon: CalendarClock },
			{ href: "/investment-plan", label: "Anlegen", icon: Sprout },
		],
	},
	{
		label: "System",
		items: [{ href: "/settings", label: "Einstellungen", icon: Settings }],
	},
];

export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
export const HIDEABLE_NAV_ITEMS = ALL_NAV_ITEMS.filter(
	(item) => item.href !== "/" && item.href !== "/settings",
);

/**
 * Pages that are not in the menu but must stay one search away, and the old
 * names of merged pages so a search for them still lands somewhere.
 */
export const PALETTE_ONLY_ITEMS: NavItem[] = [
	{ href: "/copilot", label: "Gespräch", icon: MessageCircleMore },
	{ href: "/hr-koerner", label: "Erledigt und entschieden", icon: History },
	{ href: "/settings/data-sources", label: "Datenquellen", icon: Plug },
	{ href: "/fixed-costs", label: "Verträge", icon: FileCheck2 },
];

/**
 * A saved hidden list may name entries that have since left the menu
 * ("/hr-koerner", "/copilot", and since 27.09.2026 "/overview", "/cash",
 * "/recurring" and the other merged pages); the server refuses those, so drop
 * them before the list is edited and saved again.
 */
export function hideableOnly(hiddenItems: readonly string[]): string[] {
	const allowed = new Set(HIDEABLE_NAV_ITEMS.map((item) => item.href));
	return hiddenItems.filter((href) => allowed.has(href));
}

export function visibleNavGroups(hiddenItems: readonly string[]): NavGroup[] {
	const hidden = new Set(hiddenItems);
	return NAV_GROUPS.map((group) => ({
		...group,
		items: group.items.filter(
			(item) =>
				item.href === "/" ||
				item.href === "/settings" ||
				!hidden.has(item.href),
		),
	})).filter((group) => group.items.length > 0);
}
