import { Link } from "@tanstack/react-router";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";

export type BarListItem = {
	key: string;
	label: string;
	amountMinor: number;
	share?: number;
	href?: string;
	search?: Record<string, unknown>;
	secondary?: string;
};

export function BarList({
	items,
	currency,
	className,
	max,
}: {
	items: BarListItem[];
	currency?: string;
	className?: string;
	max?: number;
}) {
	const f = useFormat();
	const top = max ?? Math.max(...items.map((i) => Math.abs(i.amountMinor)), 1);
	return (
		<ul className={cn("space-y-2.5", className)}>
			{items.map((item) => {
				const content = (
					<>
						<div className="flex items-baseline justify-between gap-3 text-[13px]">
							<span className="min-w-0 break-words text-text">
								{item.label}
							</span>
							<span className="flex shrink-0 items-baseline gap-2">
								{item.secondary ? (
									<span className="text-[11px] text-text-muted">
										{item.secondary}
									</span>
								) : null}
								<span className="amount font-semibold">
									{f.money(item.amountMinor, currency)}
								</span>
							</span>
						</div>
						<div className="mt-1 h-1.5 w-full overflow-hidden rounded-sm bg-chart-neutral-1">
							<div
								className="h-full rounded-sm bg-chart-2"
								style={{
									width: `${Math.min(100, (Math.abs(item.amountMinor) / top) * 100)}%`,
								}}
							/>
						</div>
					</>
				);
				return (
					<li key={item.key}>
						{item.href ? (
							<Link
								to={item.href}
								search={item.search as never}
								className="block rounded-sm outline-none hover:opacity-80 focus-visible:outline-2 focus-visible:outline-focus"
							>
								{content}
							</Link>
						) : (
							content
						)}
					</li>
				);
			})}
		</ul>
	);
}
