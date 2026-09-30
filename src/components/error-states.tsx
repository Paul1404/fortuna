import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function NotFoundView() {
	return (
		<div className="flex min-h-[60vh] items-center justify-center px-4">
			<div className="surface w-full max-w-md p-8 text-center">
				<p className="label-caps">404</p>
				<h1 className="mt-3 font-display text-2xl">Seite nicht gefunden</h1>
				<p className="mt-2 text-sm text-text-secondary">
					Diese Seite existiert nicht oder wurde verschoben.
				</p>
				<Button asChild className="mt-6">
					<Link to="/">Zur Startseite</Link>
				</Button>
			</div>
		</div>
	);
}

export function ErrorView({
	error,
	reset,
}: {
	error?: unknown;
	reset?: () => void;
}) {
	const message = error instanceof Error ? error.message : null;
	return (
		<div className="flex min-h-[60vh] items-center justify-center px-4">
			<div className="surface w-full max-w-md p-8 text-center">
				<p className="label-caps text-negative">Fehler</p>
				<h1 className="mt-3 font-display text-2xl">Etwas ist schiefgelaufen</h1>
				<p className="mt-2 text-sm text-text-secondary">
					Die Seite konnte nicht geladen werden.
				</p>
				{import.meta.env.DEV && message ? (
					<code className="mt-3 block overflow-x-auto rounded-sm bg-surface-sunken px-3 py-2 text-left font-mono text-xs text-text-secondary">
						{message}
					</code>
				) : null}
				<div className="mt-6 flex justify-center gap-2">
					{reset ? (
						<Button variant="outline" onClick={reset}>
							Erneut versuchen
						</Button>
					) : null}
					<Button asChild>
						<Link to="/">Zur Startseite</Link>
					</Button>
				</div>
			</div>
		</div>
	);
}
