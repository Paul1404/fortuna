import { describe, expect, it } from "vitest";
import {
	type ScalableSyncNoticeState,
	type ScalableSyncStatus,
	scalableSyncNotice,
} from "@/lib/scalable-sync-notice";

const expired =
	"Die Scalable-Anmeldung ist abgelaufen. Bitte neu verbinden. Der letzte Bestand bleibt erhalten.";
const warning =
	"1 Brokerbuchung(en) mit widersprüchlicher Identität zurückgehalten. Depot und Guthaben wurden aktualisiert.";

function status(
	at: number | null,
	patch: Partial<ScalableSyncStatus> = {},
): ScalableSyncStatus {
	return {
		status: "active",
		syncing: false,
		lastAttemptedSyncAt: at === null ? null : new Date(at),
		lastError: null,
		...patch,
	};
}

/** Feeds a sequence of polls through the reducer and collects the toasts. */
function run(polls: ScalableSyncStatus[]) {
	let state: ScalableSyncNoticeState | null = null;
	const notices: Array<{ kind: string; message: string }> = [];
	for (const poll of polls) {
		const next = scalableSyncNotice(state, poll);
		state = next.state;
		if (next.notice) notices.push(next.notice);
	}
	return notices;
}

describe("scalableSyncNotice", () => {
	it("does not repeat a failure stored before this visit", () => {
		expect(
			run([
				status(1000, { status: "error", lastError: expired }),
				status(1000, { status: "error", lastError: expired }),
			]),
		).toEqual([]);
	});

	it("shows the specific reason of an attempt that fails during the visit", () => {
		expect(
			run([
				status(1000),
				status(1000, { syncing: true }),
				status(2000, { status: "error", lastError: expired }),
			]),
		).toEqual([{ kind: "error", message: expired }]);
	});

	it("reports an attempt already running when the page first looked", () => {
		expect(
			run([
				status(2000, { syncing: true }),
				status(2000, { status: "error", lastError: expired }),
			]),
		).toEqual([{ kind: "error", message: expired }]);
	});

	it("says the same failure once, not at every hourly retry", () => {
		expect(
			run([
				status(1000),
				status(2000, { status: "error", lastError: expired }),
				status(3000, { status: "error", lastError: expired }),
				status(4000, { status: "error", lastError: expired }),
			]),
		).toEqual([{ kind: "error", message: expired }]);
	});

	it("says it again after a success in between", () => {
		expect(
			run([
				status(1000),
				status(2000, { status: "error", lastError: expired }),
				status(3000),
				status(4000, { status: "error", lastError: expired }),
			]),
		).toHaveLength(2);
	});

	it("never calls a successful sync with a warning a failure", () => {
		expect(run([status(1000), status(2000, { lastError: warning })])).toEqual([
			{ kind: "warning", message: warning },
		]);
	});

	it("stays quiet for a clean sync", () => {
		expect(run([status(null), status(2000)])).toEqual([]);
	});
});
