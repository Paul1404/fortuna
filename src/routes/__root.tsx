/// <reference types="vite/client" />
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { ErrorView, NotFoundView } from "@/components/error-states";
import { Toaster } from "@/components/ui/sonner";
import { APP_VERSION } from "@/lib/version";
import { useViewportVars } from "@/lib/viewport";
import type { RouterContext } from "@/router";
import appCss from "@/styles.css?url";

const v = `?v=${APP_VERSION}`;

export const Route = createRootRouteWithContext<RouterContext>()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			// viewport-fit=cover lets the phone tab bar and the sheets pad themselves
			// with env(safe-area-inset-*); resizes-content makes Android shrink
			// the layout viewport for the keyboard, as `useViewportVars` expects.
			{
				name: "viewport",
				content:
					"width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
			},
			{ title: "Fortuna" },
			{ name: "description", content: "Private Finanzübersicht." },
			{ name: "robots", content: "noindex, nofollow" },
			{ name: "theme-color", content: "#08112E" },
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", href: `/favicon.svg${v}`, type: "image/svg+xml" },
			{
				rel: "icon",
				href: `/favicon-32.png${v}`,
				sizes: "32x32",
				type: "image/png",
			},
			{
				rel: "icon",
				href: `/favicon-16.png${v}`,
				sizes: "16x16",
				type: "image/png",
			},
			{
				rel: "apple-touch-icon",
				href: `/apple-touch-icon.png${v}`,
				sizes: "180x180",
			},
			{ rel: "manifest", href: `/manifest.webmanifest${v}` },
		],
	}),
	notFoundComponent: () => <NotFoundView />,
	errorComponent: ({ error, reset }) => (
		<ErrorView error={error} reset={reset} />
	),
	component: () => (
		<RootDocument>
			<Outlet />
		</RootDocument>
	),
});

function ViewportVars() {
	useViewportVars();
	return null;
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
	return (
		<html lang="de" suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body className="min-h-dvh bg-bg text-text">
				<a
					href="#main-content"
					className="sr-only z-50 rounded-md bg-surface px-4 py-2 text-sm font-medium text-text ring-1 ring-border focus:not-sr-only focus:absolute focus:top-4 focus:left-4"
				>
					Zum Inhalt springen
				</a>
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					enableSystem
					disableTransitionOnChange
				>
					<ViewportVars />
					{children}
					<Toaster
						position="bottom-right"
						offset={{ bottom: "calc(var(--phone-tabbar-h, 0px) + 24px)" }}
						mobileOffset={{ bottom: "calc(var(--phone-tabbar-h, 0px) + 12px)" }}
					/>
				</ThemeProvider>
				<Scripts />
			</body>
		</html>
	);
}
