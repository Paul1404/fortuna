import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 16 px text below `sm`: iOS Safari zooms into any field set smaller, and the
 * page then stays zoomed after the keyboard closes. 44 px tall wherever the
 * pointer is a finger, 32 px under a mouse.
 */
export const inputClassName =
	"h-11 w-full min-w-0 rounded-control border border-border-strong bg-surface px-2.5 py-1 text-base text-text transition-colors outline-none placeholder:text-text-muted sm:h-8 sm:text-sm sm:pointer-coarse:h-11 focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-negative dark:bg-surface-sunken";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn(
				inputClassName,
				type === "number" && "amount",
				type === "date" && "min-w-[10.5rem] leading-normal",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * A money or quantity field. A text input with the decimal keypad rather than
 * `type="number"`: the German comma is a valid decimal separator here, and a
 * number input silently empties itself on "12,50" in some browsers. Parse the
 * value with `parseDecimalToMinor`.
 */
function AmountInput({
	className,
	...props
}: Omit<React.ComponentProps<"input">, "type">) {
	return (
		<Input
			type="text"
			inputMode="decimal"
			autoComplete="off"
			autoCorrect="off"
			spellCheck={false}
			data-slot="amount-input"
			className={cn("amount", className)}
			{...props}
		/>
	);
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(
				inputClassName,
				"h-auto min-h-20 py-2 sm:h-auto sm:pointer-coarse:h-auto",
				className,
			)}
			{...props}
		/>
	);
}

function NativeSelect({
	className,
	children,
	...props
}: React.ComponentProps<"select">) {
	return (
		<select
			data-slot="select"
			className={cn(
				inputClassName,
				"appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2377839A%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:12px] bg-[position:right_8px_center] bg-no-repeat pr-7",
				className,
			)}
			{...props}
		>
			{children}
		</select>
	);
}

export { AmountInput, Input, NativeSelect, Textarea };
