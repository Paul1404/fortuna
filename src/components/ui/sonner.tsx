import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
	const { theme = "system" } = useTheme();
	return (
		<Sonner
			theme={theme as ToasterProps["theme"]}
			style={
				{
					"--normal-bg": "var(--fortuna-surface)",
					"--normal-text": "var(--fortuna-text)",
					"--normal-border": "var(--fortuna-border)",
					"--border-radius": "8px",
				} as React.CSSProperties
			}
			{...props}
		/>
	);
}
