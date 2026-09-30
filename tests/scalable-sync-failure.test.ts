import { describe, expect, it } from "vitest";
import { ScalableSnapshotError } from "@/server/providers/investment/scalable-cli";
import {
	envelopeErrorCode,
	exitErrorCode,
	ScalableCliError,
} from "@/server/providers/investment/scalable-hosted-cli";
import {
	SCALABLE_INGEST_FAILED,
	ScalableIngestError,
	scalableSyncWarning,
} from "@/server/services/investment-sources";
import { classifyScalableSyncFailure } from "@/server/services/scalable-hosted";

describe("envelopeErrorCode", () => {
	it("keeps a bare identifier from the envelope and nothing else", () => {
		expect(
			envelopeErrorCode({ ok: false, error: { code: "UNAUTHENTICATED" } }),
		).toBe("UNAUTHENTICATED");
		expect(
			envelopeErrorCode({ ok: false, error: { type: "RATE_LIMITED" } }),
		).toBe("RATE_LIMITED");
		expect(envelopeErrorCode({ ok: false, code: "SESSION_EXPIRED" })).toBe(
			"SESSION_EXPIRED",
		);
	});

	it("reads the snake_case codes the CLI actually sends", () => {
		expect(
			envelopeErrorCode({
				ok: false,
				command: "broker.overview",
				error: {
					code: "refresh_relogin_required",
					message: "may carry account details",
				},
			}),
		).toBe("REFRESH_RELOGIN_REQUIRED");
		expect(envelopeErrorCode({ error: { code: "no_session" } })).toBe(
			"NO_SESSION",
		);
	});

	it("refuses anything that could carry account details", () => {
		expect(envelopeErrorCode({ error: { code: "Paul_Dresch" } })).toBeNull();
		expect(
			envelopeErrorCode({ error: { code: "paul@example.com" } }),
		).toBeNull();
		expect(
			envelopeErrorCode({ error: { code: "Konto DE12 3456 gesperrt" } }),
		).toBeNull();
		expect(envelopeErrorCode({ error: { code: "e" } })).toBeNull();
		expect(envelopeErrorCode({ error: { code: "x".repeat(60) } })).toBeNull();
		expect(envelopeErrorCode({ error: "UNAUTHENTICATED" })).toBeNull();
		expect(envelopeErrorCode(null)).toBeNull();
		expect(envelopeErrorCode("UNAUTHENTICATED")).toBeNull();
	});
});

describe("exitErrorCode", () => {
	it("names the exit statuses the CLI publishes", () => {
		expect(exitErrorCode(10, null)).toBe("CLI_VALIDATION_ERROR");
		expect(exitErrorCode(20, null)).toBe("CLI_AUTH_OR_CONFIG_ERROR");
		expect(exitErrorCode(30, null)).toBe("CLI_NETWORK_OR_BACKEND_ERROR");
		expect(exitErrorCode(1, null)).toBe("CLI_EXIT_1");
		expect(exitErrorCode(null, null)).toBe("CLI_EXIT_SIGNAL");
	});

	it("prefers the envelope's own reason over the status", () => {
		expect(exitErrorCode(20, { error: { code: "no_session" } })).toBe(
			"CLI_ERROR_NO_SESSION",
		);
	});
});

describe("classifyScalableSyncFailure", () => {
	it("names the failed validation check for a rejected snapshot", () => {
		const failure = classifyScalableSyncFailure(
			new ScalableSnapshotError("Portfolio total does not reconcile"),
		);
		expect(failure.errorCode).toBe("SNAPSHOT_INVALID");
		expect(failure.detail).toBe("Portfolio total does not reconcile");
		expect(failure.ownerMessage).toContain("nicht verarbeiten");
		expect(failure.ownerMessage).toContain("letzte Bestand bleibt");
	});

	it("asks the owner to reconnect when the session is gone", () => {
		for (const code of [
			"CLI_ERROR_UNAUTHENTICATED",
			"CLI_ERROR_SESSION_EXPIRED",
			"CLI_ERROR_TOKEN_REVOKED",
		]) {
			const failure = classifyScalableSyncFailure(new ScalableCliError(code));
			expect(failure.errorCode).toBe(code);
			expect(failure.ownerMessage).toContain("neu verbinden");
		}
	});

	it("asks for a new login on the auth exit status, whatever the envelope says", () => {
		for (const error of [
			new ScalableCliError("CLI_AUTH_OR_CONFIG_ERROR", undefined, 20),
			new ScalableCliError("CLI_ERROR_INTERNAL_ERROR", undefined, 20),
			new ScalableCliError("CLI_ERROR_NO_SESSION", undefined, 20),
			new ScalableCliError("CLI_ERROR_REFRESH_RELOGIN_REQUIRED", undefined, 1),
		]) {
			expect(classifyScalableSyncFailure(error).ownerMessage).toContain(
				"neu verbinden",
			);
		}
	});

	it("asks the owner to wait when the provider is not answering", () => {
		for (const code of [
			"CLI_TIMEOUT",
			"CLI_EXIT_1",
			"CLI_ENVELOPE_INVALID",
			"CLI_NETWORK_OR_BACKEND_ERROR",
		]) {
			const failure = classifyScalableSyncFailure(new ScalableCliError(code));
			expect(failure.errorCode).toBe(code);
			expect(failure.ownerMessage).toContain("nicht erreichbar");
			expect(failure.detail).toBeNull();
		}
	});

	it("owns a refused request instead of calling Scalable unreachable", () => {
		for (const error of [
			new ScalableCliError("CLI_VALIDATION_ERROR", undefined, 10),
			new ScalableCliError("CLI_ERROR_INVALID_ARGUMENT", undefined, 10),
			new ScalableCliError("CLI_VALIDATION_ERROR"),
		]) {
			const failure = classifyScalableSyncFailure(error);
			expect(failure.errorCode).toBe(error.code);
			expect(failure.ownerMessage).toContain("liegt an Fortuna");
			expect(failure.ownerMessage).not.toContain("nicht erreichbar");
			expect(failure.ownerMessage).not.toContain("neu verbinden");
			expect(failure.ownerMessage).toContain("letzte Bestand bleibt");
		}
	});

	it("keeps the network exit status as unreachable, whatever the envelope says", () => {
		const failure = classifyScalableSyncFailure(
			new ScalableCliError("CLI_ERROR_BACKEND_UNAVAILABLE", undefined, 30),
		);
		expect(failure.ownerMessage).toContain("nicht erreichbar");
	});

	it("does not ask the owner to wait for a problem on Fortuna's side", () => {
		for (const code of ["CLI_NOT_FOUND", "CLI_OUTPUT_TOO_LARGE"]) {
			const failure = classifyScalableSyncFailure(new ScalableCliError(code));
			expect(failure.errorCode).toBe(code);
			expect(failure.ownerMessage).not.toContain("nicht erreichbar");
			expect(failure.ownerMessage).not.toContain("CLI");
		}
	});

	it("writes every owner message as complete sentences without product jargon", () => {
		for (const error of [
			new ScalableSnapshotError("x"),
			new ScalableIngestError("SYNC_FAILED"),
			new ScalableCliError("CLI_AUTH_OR_CONFIG_ERROR", undefined, 20),
			new ScalableCliError("CLI_VALIDATION_ERROR", undefined, 10),
			new ScalableCliError("CLI_NETWORK_OR_BACKEND_ERROR", undefined, 30),
			new ScalableCliError("CLI_NOT_FOUND"),
			new Error("x"),
		]) {
			const { ownerMessage } = classifyScalableSyncFailure(error);
			expect(ownerMessage).toMatch(/\.$/);
			expect(ownerMessage).not.toMatch(/\.\./);
			expect(ownerMessage).not.toMatch(/\bCLI\b|Snapshot|Token|Sitzung/);
		}
	});

	it("never surfaces an unknown error's message", () => {
		const failure = classifyScalableSyncFailure(
			new Error("connect ECONNREFUSED 10.0.0.1:5432 user=paul"),
		);
		expect(failure.errorCode).toBe("SYNC_FAILED");
		expect(failure.detail).toBeNull();
		expect(failure.ownerMessage).not.toContain("ECONNREFUSED");
	});
});

describe("scalableSyncWarning", () => {
	const clean = {
		skippedHoldings: 0,
		duplicateHoldings: 0,
		skippedTransactions: 0,
		conflictingTransactions: 0,
		reconciliation: "parts" as const,
	};

	it("says nothing when nothing was left out", () => {
		expect(scalableSyncWarning(0, clean)).toBeNull();
		expect(
			scalableSyncWarning(0, { ...clean, reconciliation: "with_cash" }),
		).toBeNull();
	});

	it("names what was left out and that the depot is current", () => {
		const warning = scalableSyncWarning(1, {
			...clean,
			conflictingTransactions: 1,
			skippedHoldings: 1,
			reconciliation: "unreconciled",
		});
		expect(warning).toContain("2 Brokerbuchung(en)");
		expect(warning).toContain("1 Position(en)");
		expect(warning).toContain("nicht aus Wertpapieren und Krypto aufgeht");
		expect(warning).toContain("Depot und Guthaben wurden aktualisiert");
	});

	// The depot page renders `lastError` as it is, so every form it can take
	// must be finished sentences that state the caveat at most once.
	it("stores only finished sentences on the depot", () => {
		const warning = scalableSyncWarning(1, clean) ?? "";
		for (const text of [warning, SCALABLE_INGEST_FAILED]) {
			expect(text).toMatch(/\.$/);
			expect(text).not.toMatch(/\.\./);
			expect(text).not.toMatch(/\bCLI\b/);
			expect(text.match(/Bestand bleibt/g)?.length ?? 0).toBeLessThanOrEqual(1);
		}
	});
});
