import { DropdownMenu } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * An overflow menu: several secondary actions behind one trigger, where a row
 * of buttons would wrap into a second and third line on a phone. Items are
 * 44 px tall under a finger. Put the trigger in `MenuTrigger asChild` around
 * a `Button`.
 */
const Menu = DropdownMenu.Root;
const MenuTrigger = DropdownMenu.Trigger;

function MenuContent({
	className,
	align = "end",
	sideOffset = 4,
	...props
}: React.ComponentProps<typeof DropdownMenu.Content>) {
	return (
		<DropdownMenu.Portal>
			<DropdownMenu.Content
				align={align}
				sideOffset={sideOffset}
				collisionPadding={12}
				className={cn(
					"fortuna-dialog-in z-50 min-w-48 max-w-[calc(100vw-1.5rem)] rounded-md border border-border bg-surface p-1 shadow-overlay outline-none",
					className,
				)}
				{...props}
			/>
		</DropdownMenu.Portal>
	);
}

function MenuItem({
	className,
	...props
}: React.ComponentProps<typeof DropdownMenu.Item>) {
	return (
		<DropdownMenu.Item
			className={cn(
				"flex cursor-pointer flex-col items-start gap-0.5 rounded-control px-2.5 py-1.5 text-sm text-text outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-sunken pointer-coarse:min-h-11 pointer-coarse:justify-center",
				className,
			)}
			{...props}
		/>
	);
}

export { Menu, MenuContent, MenuItem, MenuTrigger };
