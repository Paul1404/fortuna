import type * as React from "react";
import { cn } from "@/lib/utils";

function Label({ className, ...props }: React.ComponentProps<"label">) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: callers pass htmlFor
		<label
			data-slot="label"
			className={cn("block text-xs font-medium text-text-secondary", className)}
			{...props}
		/>
	);
}

function Field({
	label,
	htmlFor,
	hint,
	error,
	children,
	className,
}: {
	label: string;
	htmlFor?: string;
	hint?: string;
	error?: string | null;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("space-y-1.5", className)}>
			<Label htmlFor={htmlFor}>{label}</Label>
			{children}
			{error ? (
				<p className="text-xs text-negative" role="alert">
					{error}
				</p>
			) : hint ? (
				<p className="text-xs text-text-muted">{hint}</p>
			) : null}
		</div>
	);
}

export { Field };
