import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const TABS = [
	{ to: "/settings", label: "Allgemein" },
	{ to: "/settings/data-sources", label: "Datenquellen" },
	{ to: "/settings/hr-koerner", label: "Hr. Körner" },
] as const;

/**
 * Einstellungen as tabs: general settings, the data sources (connections and
 * CSV import/export, which used to be two menu entries) and Hr. Körner's
 * financial rules.
 */
export function SettingsTabs() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	return (
		<nav
			aria-label="Einstellungen"
			className="flex flex-wrap gap-1 border-b border-border"
		>
			{TABS.map((tab) => {
				const active = pathname === tab.to;
				return (
					<Link
						key={tab.to}
						to={tab.to}
						aria-current={active ? "page" : undefined}
						className={cn(
							"-mb-px border-b-2 px-3 py-2 text-sm font-medium outline-none focus-visible:outline-2 focus-visible:outline-focus",
							active
								? "border-brand text-text"
								: "border-transparent text-text-secondary hover:text-text",
						)}
					>
						{tab.label}
					</Link>
				);
			})}
		</nav>
	);
}
