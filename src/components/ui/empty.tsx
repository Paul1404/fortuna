import type { ReactNode } from "react";

export function EmptyState({
	title,
	description,
	action,
}: {
	title: string;
	description?: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
			<p className="text-sm font-medium text-text">{title}</p>
			{description ? (
				<p className="max-w-sm text-xs text-text-secondary">{description}</p>
			) : null}
			{action ? <div className="mt-2">{action}</div> : null}
		</div>
	);
}
