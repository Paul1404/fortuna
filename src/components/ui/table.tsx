import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * `stacked` turns the table into one card per row below 640px, with each cell
 * on its own line beside the label passed to `TableCell`. A phone cannot show
 * a wide table without hiding part of it, and a horizontally clipped amount
 * reads as a complete number: "+2.927,2" looks like a figure, not a fragment.
 */
function Table({
	className,
	stacked,
	...props
}: React.ComponentProps<"table"> & { stacked?: boolean }) {
	return (
		<div
			data-slot="table-container"
			className={cn(
				"relative w-full overflow-x-auto overscroll-x-contain",
				stacked && "max-sm:overflow-visible",
			)}
		>
			<table
				data-slot="table"
				data-stacked={stacked ? "true" : undefined}
				className={cn(
					"w-full caption-bottom text-[13px]",
					stacked && [
						"max-sm:block",
						"max-sm:[&_thead]:hidden",
						"max-sm:[&_tbody]:block max-sm:[&_tbody]:space-y-2",
						"max-sm:[&_tfoot]:block",
						"max-sm:[&_tr]:block max-sm:[&_tr]:rounded-md max-sm:[&_tr]:border max-sm:[&_tr]:border-border max-sm:[&_tr]:p-3",
						"max-sm:[&_td]:flex max-sm:[&_td]:items-baseline max-sm:[&_td]:justify-between max-sm:[&_td]:gap-3",
						"max-sm:[&_td]:px-0 max-sm:[&_td]:py-1 max-sm:[&_td]:text-left",
					],
					className,
				)}
				{...props}
			/>
		</div>
	);
}
function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
	return (
		<thead
			className={cn("[&_tr]:border-b [&_tr]:border-border", className)}
			{...props}
		/>
	);
}
function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
	return (
		<tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />
	);
}
function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
	return (
		<tfoot
			className={cn(
				"border-t border-border bg-surface-sunken/60 font-medium",
				className,
			)}
			{...props}
		/>
	);
}
/**
 * `onActivate` makes a whole row operable: clicking it and pressing Enter or
 * Space both reach the same handler, and the row takes focus. The row keeps
 * its native table semantics — overriding the role would take it out of the
 * table for a screen reader.
 */
function TableRow({
	className,
	onActivate,
	...props
}: React.ComponentProps<"tr"> & { onActivate?: () => void }) {
	return (
		<tr
			className={cn(
				"border-b border-border transition-colors hover:bg-surface-sunken/60 data-[state=selected]:bg-brand-subtle",
				onActivate &&
					"cursor-pointer focus-visible:bg-surface-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand",
				className,
			)}
			{...(onActivate
				? {
						tabIndex: 0,
						onClick: onActivate,
						onKeyDown: (event: React.KeyboardEvent<HTMLTableRowElement>) => {
							if (event.key !== "Enter" && event.key !== " ") return;
							if (event.target !== event.currentTarget) return;
							event.preventDefault();
							onActivate();
						},
					}
				: {})}
			{...props}
		/>
	);
}
function TableHead({ className, ...props }: React.ComponentProps<"th">) {
	return (
		<th
			className={cn(
				"label-caps min-h-9 break-words px-3 py-2 text-left align-middle first:pl-4 last:pr-4",
				className,
			)}
			{...props}
		/>
	);
}
function TableCell({
	className,
	label,
	children,
	...props
}: React.ComponentProps<"td"> & { label?: string }) {
	return (
		<td
			className={cn(
				"break-words px-3 py-2 align-middle first:pl-4 last:pr-4",
				className,
			)}
			{...props}
		>
			{label ? (
				<span className="hidden shrink-0 text-text-muted max-sm:in-data-[stacked=true]:inline">
					{label}
				</span>
			) : null}
			{/* Only in a `stacked` table on a phone: wrapped so the label and the
			    value sit at opposite ends of the card line. An ordinary table
			    keeps its own alignment; right-aligning it centred names on a
			    phone. */}
			<span className="contents max-sm:in-data-[stacked=true]:block max-sm:in-data-[stacked=true]:min-w-0 max-sm:in-data-[stacked=true]:text-right">
				{children}
			</span>
		</td>
	);
}

export {
	Table,
	TableBody,
	TableCell,
	TableFooter,
	TableHead,
	TableHeader,
	TableRow,
};
