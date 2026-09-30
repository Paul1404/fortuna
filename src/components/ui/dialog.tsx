import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

/**
 * A centred dialog from `sm` up; below it a bottom sheet: full width, rounded
 * top, a handle, at most the visible height, scrolling inside itself. The
 * sheet sits on `--keyboard-inset` (set by `useViewportVars` in the root
 * document), so iOS Safari's on-screen keyboard pushes it up instead of hiding
 * the field being typed into.
 *
 * The content itself is the scroll container. Actions belong in a
 * `DialogFooter`, which sticks to its bottom edge, so "Speichern" stays in
 * reach however long the form above it is. The sheet keeps `p-5` /
 * `max-sm:p-4` so footers can bleed to its edges with negative margins; the
 * home-indicator inset is the footer's to pad, not the sheet's.
 */
function DialogContent({
	className,
	children,
	title,
	description,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
	title: string;
	description?: string;
}) {
	return (
		<DialogPrimitive.Portal>
			<DialogPrimitive.Overlay className="fortuna-overlay-in fixed inset-0 z-50 bg-black/30" />
			<DialogPrimitive.Content
				data-slot="dialog-content"
				className={cn(
					"fixed z-50 flex flex-col gap-4 overflow-y-auto overscroll-contain border border-border bg-surface shadow-overlay outline-none",
					// Desktop and tablet: centred.
					"sm:fortuna-dialog-in top-1/2 left-1/2 max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-md p-5",
					// Phone: a bottom sheet above the keyboard and the home indicator.
					"max-sm:fortuna-sheet-in max-sm:top-auto max-sm:right-0 max-sm:bottom-[var(--keyboard-inset,0px)] max-sm:left-0 max-sm:max-h-[calc(var(--app-vvh,100dvh)-0.75rem)] max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-t-[var(--radius-lg)] max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:px-4 max-sm:pt-2 max-sm:pb-4",
					className,
				)}
				{...props}
			>
				<div
					aria-hidden
					className="mx-auto -mb-2 h-1 w-10 shrink-0 rounded-full bg-border-strong sm:hidden"
				/>
				<div className="flex items-start justify-between gap-4">
					{/* min-w-0: a long booking text as the title otherwise pushes the
					    close button out of the dialog instead of wrapping. */}
					<div className="min-w-0 max-sm:pt-2">
						<DialogPrimitive.Title className="break-words font-semibold text-[15px] text-text">
							{title}
						</DialogPrimitive.Title>
						{description ? (
							<DialogPrimitive.Description className="mt-1 text-xs text-text-secondary">
								{description}
							</DialogPrimitive.Description>
						) : (
							<DialogPrimitive.Description className="sr-only">
								{title}
							</DialogPrimitive.Description>
						)}
					</div>
					<DialogPrimitive.Close
						className="grid shrink-0 place-items-center rounded-control p-1 text-text-muted hover:bg-surface-sunken hover:text-text pointer-coarse:min-h-11 pointer-coarse:min-w-11 max-sm:-mr-2"
						aria-label="Schließen"
					>
						<XIcon className="size-4" />
					</DialogPrimitive.Close>
				</div>
				{children}
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	);
}

/**
 * The dialog's actions, primary last. It sticks to the bottom of the dialog
 * while the content above scrolls, and on a phone its buttons share the
 * width so each is a thumb-sized target. `sticky={false}` keeps it in the
 * flow, for a dialog whose actions belong mid-content. `-bottom-5`, not
 * `bottom-0`: a sticky inset counts from inside the scroll container's
 * padding, and the footer has to meet the sheet's real bottom edge.
 */
function DialogFooter({
	className,
	sticky = true,
	...props
}: React.ComponentProps<"div"> & { sticky?: boolean }) {
	return (
		<div
			data-slot="dialog-footer"
			className={cn(
				"flex flex-wrap items-center justify-end gap-2 max-sm:[&>:is(button,a)]:flex-1 max-sm:[&>:is(button,a)]:basis-32",
				sticky &&
					"sticky -bottom-5 z-10 mt-auto -mx-5 -mb-5 border-t border-border bg-surface px-5 py-3 max-sm:-bottom-4 max-sm:-mx-4 max-sm:-mb-4 max-sm:px-4 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]",
				className,
			)}
			{...props}
		/>
	);
}

export { Dialog, DialogContent, DialogFooter };
