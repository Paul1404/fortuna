import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import {
	ArrowLeftRight,
	LogOut,
	Menu,
	NotebookPen,
	Scale,
	Search,
	SlidersHorizontal,
	Wallet,
	X,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { FortunaLockup } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { TickingMoney } from "@/components/ticking-money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { VersionChip } from "@/components/version-chip";
import { inAppNotificationEligible } from "@/domain/hr-koerner-notifications";
import { authClient } from "@/lib/auth-client";
import { useFormat } from "@/lib/format";
import { reportError, useInvalidateAll } from "@/lib/forms";
import { indicativeNetWorth, useMarketPulse } from "@/lib/market-pulse";
import {
	HIDEABLE_NAV_ITEMS,
	hideableOnly,
	NAV_GROUPS,
	visibleNavGroups,
} from "@/lib/navigation";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";

export function Sidebar({
	userName,
	onOpenSearch,
}: {
	userName: string;
	onOpenSearch: () => void;
}) {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const { data: netWorth } = useQuery(orpc.netWorth.current.queryOptions());
	const { data: pulse } = useMarketPulse();
	const { data: settings } = useQuery(orpc.settings.get.queryOptions());
	const { data: observations } = useQuery(
		orpc.hrKoerner.observations.queryOptions(),
	);
	const f = useFormat();
	const [open, setOpen] = useState(false);
	const [customizeOpen, setCustomizeOpen] = useState(false);
	const [hiddenDraft, setHiddenDraft] = useState<string[]>([]);
	const [pending, startTransition] = useTransition();
	const invalidate = useInvalidateAll();
	const saveNavigation = useMutation(
		orpc.settings.update.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				setCustomizeOpen(false);
				toast.success("Menü gespeichert");
			},
			onError: reportError,
		}),
	);
	const navAmount = (href: string) => {
		if (!netWorth) return null;
		const amount =
			href === "/net-worth"
				? netWorth.netWorthMinor
				: href === "/assets"
					? netWorth.physicalMinor
					: null;
		return amount === null
			? null
			: f.money(amount, netWorth.baseCurrency, { compact: true });
	};

	// The phone menu covers the page: close it when the page changes (a
	// back swipe, a link inside it) and on Escape, and keep the page under
	// it from scrolling.
	useEffect(() => {
		setOpen(false);
	}, [pathname]);
	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		const root = document.documentElement;
		const previous = root.style.overflow;
		root.style.overflow = "hidden";
		document.addEventListener("keydown", onKey);
		return () => {
			root.style.overflow = previous;
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	function logout() {
		startTransition(async () => {
			await authClient.signOut();
			window.location.assign("/login");
		});
	}

	const nav = (
		<nav
			aria-label="Hauptnavigation"
			className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4"
		>
			{visibleNavGroups(settings?.hiddenNavItems ?? []).map((group) => (
				<div key={group.label ?? "top"}>
					{group.label ? (
						<p className="label-caps mb-1.5 px-2 text-nav-muted">
							{group.label}
						</p>
					) : null}
					<ul className="space-y-0.5">
						{group.items.map(({ href, label, icon: Icon, exact }) => {
							const active = exact
								? pathname === href
								: pathname === href || pathname.startsWith(`${href}/`);
							return (
								<li key={href}>
									<Link
										to={href}
										onClick={() => setOpen(false)}
										aria-current={active ? "page" : undefined}
										className={cn(
											"relative flex items-center gap-2.5 rounded-md border-l-2 border-transparent px-2 py-1.5 text-[13px] text-nav-text outline-none transition-colors max-sm:py-3 max-sm:text-sm hover:bg-nav-raised hover:text-nav-active focus-visible:outline-2 focus-visible:outline-focus",
											active &&
												"border-glow bg-nav-raised font-medium text-nav-active shadow-[inset_0_0_24px_-8px_var(--fortuna-glow)]",
										)}
									>
										<Icon
											className={cn(
												"size-4 shrink-0",
												active ? "text-glow" : "text-nav-muted",
											)}
										/>
										<span className="min-w-0 flex-1">{label}</span>
										{href === "/" &&
										observations?.some(inAppNotificationEligible) ? (
											<span
												className="size-2 rounded-full bg-warning"
												role="status"
											>
												<span className="sr-only">Neue Hinweise</span>
											</span>
										) : null}
										{href === "/net-worth" && netWorth ? (
											// Ticks with the quotes on every page, not only the
											// dashboard: the same pulse, the same snapshot rule.
											<TickingMoney
												amountMinor={indicativeNetWorth(
													netWorth.netWorthMinor,
													pulse,
												)}
												readingKey={pulse?.checkedAt}
												currency={netWorth.baseCurrency}
												compact
												countUp={false}
												weight="normal"
												className="text-[10px] text-nav-muted"
											/>
										) : navAmount(href) ? (
											<span className="amount text-[10px] text-nav-muted">
												{navAmount(href)}
											</span>
										) : null}
									</Link>
								</li>
							);
						})}
					</ul>
				</div>
			))}
		</nav>
	);

	const footer = (
		<div className="border-t border-nav-border px-3 py-3">
			<button
				type="button"
				onClick={() => {
					setHiddenDraft(hideableOnly(settings?.hiddenNavItems ?? []));
					setCustomizeOpen(true);
				}}
				className="mb-2 flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-nav-text hover:bg-nav-raised hover:text-nav-active sm:min-h-0"
			>
				<SlidersHorizontal className="size-3.5" /> Menü anpassen
			</button>
			<div className="flex items-center justify-between gap-2">
				<div className="min-w-0">
					<p className="break-words text-xs font-medium text-nav-active">
						{userName}
					</p>
					<VersionChip className="mt-1" />
				</div>
				<ThemeToggle />
			</div>
			<button
				type="button"
				onClick={logout}
				disabled={pending}
				className="mt-2 flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-nav-text hover:bg-nav-raised hover:text-nav-active sm:min-h-0"
			>
				<LogOut className="size-3.5" /> Abmelden
			</button>
		</div>
	);

	return (
		<>
			<header className="nav-surface on-navy sticky top-0 z-40 border-b border-nav-border pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] [view-transition-name:nav-top] lg:hidden">
				<div className="flex h-12 items-center justify-between pr-1.5 pl-4">
					<Link
						to="/"
						aria-label="Fortuna, zu Hr. Körner"
						onClick={() => setOpen(false)}
					>
						<FortunaLockup className="text-nav-active" />
					</Link>
					<button
						type="button"
						onClick={() => {
							setOpen(false);
							onOpenSearch();
						}}
						aria-label="Suchen"
						className="grid size-11 place-items-center rounded-control text-nav-text hover:bg-nav-raised"
					>
						<Search className="size-5" />
					</button>
				</div>
			</header>
			{open ? (
				<div
					id="phone-menu"
					className="nav-surface on-navy fixed inset-x-0 top-[var(--phone-header-h)] bottom-[var(--phone-tabbar-h)] z-30 flex flex-col overscroll-contain pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] lg:hidden"
				>
					{nav}
					{footer}
				</div>
			) : null}
			<PhoneTabBar
				pathname={pathname}
				hidden={settings?.hiddenNavItems ?? []}
				menuOpen={open}
				onToggleMenu={() => setOpen((current) => !current)}
				onNavigate={() => setOpen(false)}
				koernerNotice={Boolean(observations?.some(inAppNotificationEligible))}
			/>
			<aside className="nav-surface on-navy sticky top-0 hidden h-dvh w-[236px] shrink-0 flex-col border-r border-nav-border [view-transition-name:nav-rail] lg:flex">
				<div className="flex h-14 items-center justify-between border-b border-nav-border px-5">
					<Link
						to="/"
						aria-label="Fortuna, zu Hr. Körner"
						className="rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-focus"
					>
						<FortunaLockup className="text-nav-active" />
					</Link>
				</div>
				<div className="px-3 pt-3">
					<button
						type="button"
						onClick={onOpenSearch}
						className="flex w-full items-center gap-2 rounded-md border border-nav-border bg-nav-raised px-2.5 py-1.5 text-left text-xs text-nav-muted transition-colors hover:border-glow/70 hover:text-nav-text"
					>
						<Search className="size-3.5" />
						<span className="flex-1">Suchen</span>
						<kbd className="rounded-sm border border-nav-border px-1 font-mono text-[10px]">
							⌘K
						</kbd>
					</button>
				</div>
				{nav}
				{footer}
			</aside>
			<Dialog open={customizeOpen} onOpenChange={setCustomizeOpen}>
				<DialogContent
					title="Menü anpassen"
					description="Ausgeblendete Bereiche bleiben erreichbar. Hr. Körner, Einstellungen und dieser Schalter bleiben immer sichtbar."
				>
					<div className="max-h-[55dvh] space-y-4 overflow-y-auto pr-1">
						{NAV_GROUPS.map((group) => {
							const choices = group.items.filter((item) =>
								HIDEABLE_NAV_ITEMS.some((option) => option.href === item.href),
							);
							if (!choices.length) return null;
							return (
								<fieldset key={group.label ?? "start"} className="space-y-2">
									<legend className="label-caps mb-1">
										{group.label ?? "Start"}
									</legend>
									{choices.map((item) => (
										<label
											key={item.href}
											className="flex min-h-8 items-center gap-2 text-sm text-text"
										>
											<input
												type="checkbox"
												checked={!hiddenDraft.includes(item.href)}
												onChange={(event) =>
													setHiddenDraft((current) =>
														event.target.checked
															? current.filter((href) => href !== item.href)
															: [...current, item.href],
													)
												}
												className="accent-brand"
											/>
											{item.label}
										</label>
									))}
								</fieldset>
							);
						})}
					</div>
					<div className="flex flex-wrap justify-end gap-2">
						<Button
							variant="ghost"
							type="button"
							onClick={() => setHiddenDraft([])}
						>
							Alle anzeigen
						</Button>
						<Button
							type="button"
							disabled={saveNavigation.isPending}
							onClick={() =>
								saveNavigation.mutate({ hiddenNavItems: hiddenDraft })
							}
						>
							Speichern
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}

/**
 * The phone's bottom tab bar: the four destinations used every day, one tap
 * away from the thumb, and "Mehr" for the whole menu. Installed as a
 * standalone app there is no browser chrome to fall back on, and a
 * hamburger in the top corner is the furthest point from the thumb. Menu
 * entries the owner hid stay hidden here too.
 */
const PHONE_TABS = [
	{ href: "/", label: "Hr. Körner", icon: NotebookPen, exact: true },
	{
		href: "/transactions",
		label: "Umsätze",
		icon: ArrowLeftRight,
		exact: false,
	},
	{ href: "/accounts", label: "Konten", icon: Wallet, exact: false },
	{ href: "/net-worth", label: "Vermögen", icon: Scale, exact: false },
];

function isActive(pathname: string, href: string, exact: boolean) {
	return exact
		? pathname === href
		: pathname === href || pathname.startsWith(`${href}/`);
}

const TAB_CLASS =
	"relative flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-control px-1 text-[10.5px] leading-tight outline-none focus-visible:outline-2 focus-visible:outline-focus";

function TabGlow() {
	return (
		<span
			aria-hidden
			className="absolute -top-1 h-0.5 w-8 rounded-full bg-glow shadow-[0_0_12px_var(--fortuna-glow)]"
		/>
	);
}

function PhoneTabBar({
	pathname,
	hidden,
	menuOpen,
	onToggleMenu,
	onNavigate,
	koernerNotice,
}: {
	pathname: string;
	hidden: readonly string[];
	menuOpen: boolean;
	onToggleMenu: () => void;
	onNavigate: () => void;
	koernerNotice: boolean;
}) {
	const tabs = PHONE_TABS.filter(
		(tab) => tab.href === "/" || !hidden.includes(tab.href),
	);
	// "Mehr" is lit on every page that has no tab of its own.
	const moreActive =
		menuOpen || !tabs.some((tab) => isActive(pathname, tab.href, tab.exact));
	return (
		<nav
			aria-label="Schnellnavigation"
			className="nav-surface on-navy fixed inset-x-0 bottom-0 z-40 border-t border-nav-border pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] [view-transition-name:nav-tabs] lg:hidden [:root[data-keyboard=open]_&]:hidden"
		>
			<ul className="mx-auto flex h-14 max-w-xl items-stretch gap-1 px-1.5 py-1">
				{tabs.map((tab) => {
					const active = !menuOpen && isActive(pathname, tab.href, tab.exact);
					const Icon = tab.icon;
					return (
						<li key={tab.href} className="flex min-w-0 flex-1">
							<Link
								to={tab.href}
								onClick={onNavigate}
								aria-current={active ? "page" : undefined}
								className={cn(
									TAB_CLASS,
									active ? "text-nav-active" : "text-nav-muted",
								)}
							>
								{active ? <TabGlow /> : null}
								<span className="relative">
									<Icon
										className={cn("size-5", active && "text-glow")}
										aria-hidden
									/>
									{tab.href === "/" && koernerNotice ? (
										<span className="absolute -top-0.5 -right-1 size-2 rounded-full bg-warning ring-2 ring-nav">
											<span className="sr-only">Neue Hinweise</span>
										</span>
									) : null}
								</span>
								<span className="max-w-full break-words text-center">
									{tab.label}
								</span>
							</Link>
						</li>
					);
				})}
				<li className="flex min-w-0 flex-1">
					<button
						type="button"
						onClick={onToggleMenu}
						aria-expanded={menuOpen}
						aria-controls="phone-menu"
						className={cn(
							TAB_CLASS,
							moreActive ? "text-nav-active" : "text-nav-muted",
						)}
					>
						{moreActive ? <TabGlow /> : null}
						{menuOpen ? (
							<X className="size-5 text-glow" aria-hidden />
						) : (
							<Menu
								className={cn("size-5", moreActive && "text-glow")}
								aria-hidden
							/>
						)}
						<span>{menuOpen ? "Schließen" : "Mehr"}</span>
					</button>
				</li>
			</ul>
		</nav>
	);
}
