import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
	"inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap",
	{
		variants: {
			variant: {
				default: "border-border bg-surface-sunken text-text-secondary",
				brand: "border-transparent bg-brand-subtle text-brand",
				positive: "border-transparent bg-positive-bg text-positive",
				negative: "border-transparent bg-negative-bg text-negative",
				warning: "border-transparent bg-warning-bg text-warning",
				info: "border-transparent bg-info-bg text-info",
				accent: "border-transparent bg-brand-subtle text-accent",
			},
		},
		defaultVariants: { variant: "default" },
	},
);

function Badge({
	className,
	variant,
	...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
	return (
		<span className={cn(badgeVariants({ variant }), className)} {...props} />
	);
}

export { Badge, badgeVariants };
