import { Dialog, DialogContent } from "@/components/ui/dialog";
import { RELEASES } from "@/lib/release-notes";
import { APP_VERSION } from "@/lib/version";

export function ReleaseNotesDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title="Was ist neu?"
				description="Änderungen und Verbesserungen in Fortuna, neueste zuerst."
				className="sm:max-w-lg"
			>
				<div className="space-y-6">
					{RELEASES.map((release) => (
						<section key={release.version} className="space-y-2">
							<div className="flex flex-wrap items-baseline gap-2">
								<h3 className="font-mono text-sm font-semibold text-text">
									v{release.version}
								</h3>
								{release.version === APP_VERSION ? (
									<span className="rounded-full border border-positive/40 bg-positive-bg px-1.5 py-0.5 text-[10px] font-medium leading-none text-positive">
										aktuell
									</span>
								) : null}
								{release.date ? (
									<span className="font-mono text-[11px] text-text-muted">
										{release.date}
									</span>
								) : null}
							</div>
							<ul className="list-disc space-y-1 pl-4 text-sm text-text-secondary">
								{release.notes.map((note) => (
									<li key={note}>{note}</li>
								))}
							</ul>
						</section>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}
