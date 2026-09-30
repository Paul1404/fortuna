import type * as React from "react";
import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.ComponentProps<"section">) {
	return (
		<section
			className={cn("surface flex min-w-0 max-w-full flex-col", className)}
			{...props}
		/>
	);
}

function CardHeader({
	title,
	subtitle,
	action,
	className,
}: {
	title: React.ReactNode;
	subtitle?: React.ReactNode;
	action?: React.ReactNode;
	className?: string;
}) {
	return (
		<header
			className={cn(
				"flex flex-wrap items-start justify-between gap-3 px-4 pt-4 pb-3",
				className,
			)}
		>
			<div className="min-w-0">
				<h2 className="text-[15px] font-semibold leading-tight text-text">
					{title}
				</h2>
				{subtitle ? (
					<p className="mt-0.5 text-xs text-text-secondary">{subtitle}</p>
				) : null}
			</div>
			{action ? <div className="max-w-full shrink-0">{action}</div> : null}
		</header>
	);
}

function CardBody({ className, ...props }: React.ComponentProps<"div">) {
	return <div className={cn("px-4 pb-4", className)} {...props} />;
}

export { Card, CardBody, CardHeader };
