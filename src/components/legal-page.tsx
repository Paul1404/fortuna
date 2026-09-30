import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { FortunaLockup } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { VersionChip } from "@/components/version-chip";

export function LegalPage({
	title,
	updated,
	children,
}: {
	title: string;
	updated: string;
	children: ReactNode;
}) {
	return (
		<main
			id="main-content"
			className="mx-auto min-h-dvh w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12"
		>
			<header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
				<Link
					to="/login"
					aria-label="Zur Anmeldung"
					className="rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-focus"
				>
					<FortunaLockup />
				</Link>
				<div className="flex items-center gap-2">
					<VersionChip />
					<ThemeToggle />
				</div>
			</header>

			<article className="py-8">
				<p className="label-caps">Rechtliche Informationen</p>
				<h1 className="mt-3 font-display text-3xl font-normal text-text sm:text-4xl">
					{title}
				</h1>
				<p className="mt-2 text-xs text-text-muted">Stand: {updated}</p>
				<div className="legal-content mt-8 space-y-7 text-sm leading-7 text-text-secondary">
					{children}
				</div>
			</article>

			<footer className="flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-5 text-xs text-text-muted">
				<Link to="/login" className="hover:text-text hover:underline">
					Zur Anmeldung
				</Link>
				<Link to="/privacy" className="hover:text-text hover:underline">
					Datenschutz
				</Link>
				<Link to="/terms" className="hover:text-text hover:underline">
					Nutzungsbedingungen
				</Link>
			</footer>
		</main>
	);
}

export function LegalSection({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<section>
			<h2 className="mb-2 text-base font-semibold text-text">{title}</h2>
			{children}
		</section>
	);
}

export function LegalList({ children }: { children: ReactNode }) {
	return <ul className="list-disc space-y-1 pl-5">{children}</ul>;
}
