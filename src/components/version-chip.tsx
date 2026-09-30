import { lazy, Suspense, useState } from "react";
import { cn } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";

const ReleaseNotesDialog = lazy(() =>
	import("@/components/release-notes-dialog").then((module) => ({
		default: module.ReleaseNotesDialog,
	})),
);

export function VersionChip({ className }: { className?: string }) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				className={cn(
					"inline-flex min-h-7 items-center gap-1.5 rounded-full border border-border bg-surface-sunken px-2 py-1 font-mono text-[10px] leading-none text-text-muted transition-colors hover:border-border-strong hover:text-text",
					className,
				)}
				title={`Fortuna v${APP_VERSION}: Versionshinweise öffnen`}
			>
				<span className="size-1.5 rounded-full bg-positive" />v{APP_VERSION}
			</button>
			{open ? (
				<Suspense fallback={null}>
					<ReleaseNotesDialog open={open} onOpenChange={setOpen} />
				</Suspense>
			) : null}
		</>
	);
}
