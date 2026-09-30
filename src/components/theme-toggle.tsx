import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const MODES = [
	{ value: "system", label: "System", icon: Monitor },
	{ value: "light", label: "Hell", icon: Sun },
	{ value: "dark", label: "Dunkel", icon: Moon },
] as const;

export function ThemeToggle({ className }: { className?: string }) {
	const { theme, setTheme } = useTheme();
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	const active = mounted ? theme : null;
	return (
		<fieldset
			className={cn(
				"inline-flex items-center rounded-md border border-border p-0.5",
				className,
			)}
			aria-label="Farbschema"
		>
			<legend className="sr-only">Farbschema</legend>
			{MODES.map(({ value, label, icon: Icon }) => (
				<button
					key={value}
					type="button"
					aria-pressed={mounted ? active === value : undefined}
					aria-label={label}
					title={label}
					onClick={() => setTheme(value)}
					className={cn(
						"inline-flex size-11 items-center justify-center rounded-sm text-text-muted outline-none hover:text-text focus-visible:outline-2 focus-visible:outline-focus sm:size-7",
						active === value && "bg-surface-sunken text-text",
					)}
				>
					<Icon className="size-3.5" />
				</button>
			))}
		</fieldset>
	);
}
