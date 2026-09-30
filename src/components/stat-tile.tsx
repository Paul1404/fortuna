import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatTile({
	label,
	value,
	detail,
	className,
}: {
	label: string;
	value: ReactNode;
	detail?: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("flex min-w-0 flex-col gap-2 px-4 py-3.5", className)}>
			<p className="label-caps">{label}</p>
			<p className="amount max-w-full overflow-x-auto text-[clamp(1rem,3vw,1.375rem)] font-semibold leading-tight text-text">
				{value}
			</p>
			<div className="min-w-0 text-xs">{detail}</div>
		</div>
	);
}

export function StatRow({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"surface grid grid-cols-1 divide-y divide-border min-[430px]:grid-cols-2 md:grid-cols-3 md:divide-y-0 md:divide-x xl:grid-cols-5 min-[430px]:[&>*:nth-child(odd)]:max-md:border-r min-[430px]:[&>*:nth-child(odd)]:max-md:border-border",
				className,
			)}
		>
			{children}
		</div>
	);
}
