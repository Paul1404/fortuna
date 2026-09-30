/**
 * Which Scalable sync outcome deserves a toast. The layout polls the
 * connection status on every page; without this, a failure stored on an
 * earlier visit toasted again on every load, a successful sync that only
 * left something out was announced as a failure, and the owner never saw
 * the reason the server had already worked out.
 *
 * A toast belongs to an attempt that settled while the owner was here, and
 * only when its message differs from the one before it: an expired session
 * that fails the same way every hour is said once, then left to the
 * Verbindungen page.
 */

export type ScalableSyncStatus = {
	status: string;
	syncing: boolean;
	lastAttemptedSyncAt: Date | null;
	lastError: string | null;
};

export type ScalableSyncNoticeState = {
	/** The settled attempt already accounted for; `IN_PROGRESS` if none yet. */
	attempt: number | null;
	/** The message that attempt left, shown or already known. */
	message: string | null;
};

export type ScalableSyncNotice = {
	kind: "error" | "warning";
	message: string;
};

/** An attempt was running when the page first looked; its outcome is news. */
const IN_PROGRESS = -1;

export function scalableSyncNotice(
	previous: ScalableSyncNoticeState | null,
	current: ScalableSyncStatus,
): { state: ScalableSyncNoticeState; notice: ScalableSyncNotice | null } {
	const attempt = current.lastAttemptedSyncAt?.getTime() ?? null;
	if (!previous)
		return {
			state: current.syncing
				? { attempt: IN_PROGRESS, message: null }
				: { attempt, message: current.lastError },
			notice: null,
		};
	if (current.syncing || attempt === previous.attempt)
		return { state: previous, notice: null };
	const state = { attempt, message: current.lastError };
	if (!current.lastError || current.lastError === previous.message)
		return { state, notice: null };
	return {
		state,
		notice: {
			// A sync that succeeded keeps its status active; what it stored is
			// what it left out, not a failure.
			kind: current.status === "error" ? "error" : "warning",
			message: current.lastError,
		},
	};
}
