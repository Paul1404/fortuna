import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
	"inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control border border-transparent text-sm font-medium whitespace-nowrap transition-colors outline-none select-none pointer-coarse:min-h-11 pointer-coarse:min-w-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default:
					"bg-brand text-text-inverse hover:bg-brand-hover hover:shadow-glow",
				outline:
					"border-border-strong bg-surface text-text hover:border-brand hover:bg-surface-sunken hover:text-brand",
				ghost: "text-text-secondary hover:bg-surface-sunken hover:text-text",
				destructive:
					"bg-negative-bg text-negative hover:bg-negative hover:text-text-inverse",
				link: "text-brand underline-offset-4 hover:underline",
			},
			size: {
				default: "h-8 px-3",
				sm: "h-7 px-2.5 text-xs",
				lg: "h-10 px-4",
				icon: "size-8",
				"icon-sm": "size-7",
			},
		},
		defaultVariants: { variant: "default", size: "default" },
	},
);

function Button({
	className,
	variant,
	size,
	asChild = false,
	...props
}: React.ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
	const Comp = asChild ? Slot.Root : "button";
	return (
		<Comp
			data-slot="button"
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { Button, buttonVariants };
