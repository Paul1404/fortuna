import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
	title,
	subtitle,
	actions,
	className,
	level = 1,
}: {
	/** 2 when the header introduces one section of a page with several. */
	level?: 1 | 2;
	title: string;
	subtitle?: ReactNode;
	actions?: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-wrap items-end justify-between gap-3",
				className,
			)}
		>
			<div>
				{level === 1 ? (
					<h1 className="font-display text-[26px] font-normal leading-tight tracking-[-0.01em] text-text">
						{title}
					</h1>
				) : (
					<h2 className="font-display text-xl font-normal leading-tight text-text">
						{title}
					</h2>
				)}
				{subtitle ? (
					<p className="mt-1 text-[13px] text-text-secondary">{subtitle}</p>
				) : null}
			</div>
			{actions ? (
				// flex-1 on every action forced them to an equal share narrower than
				// their own label, so the text escaped the button. They keep their
				// natural width and wrap to the next line instead.
				<div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
					{actions}
				</div>
			) : null}
		</div>
	);
}
