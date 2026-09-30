import { describe, expect, it } from "vitest";
import { encryptSecret } from "@/server/crypto";
import {
	AUTOMATIC_SYNC_ERROR_RETRY_MS,
	AUTOMATIC_SYNC_RATE_LIMIT_RETRY_MS,
	isAutomaticSyncDue,
	PRESENT_SYNC_INTERVAL_MS,
	UNATTENDED_SYNC_INTERVAL_MS,
} from "@/server/services/connections";
import { hasEnableBankingSession } from "@/server/services/enable-banking";

const now = new Date("2026-09-15T12:00:00Z");

const grantedSession = encryptSecret(
	JSON.stringify({ sessionId: "s", accountUids: ["a"] }),
);

function connection(overrides: Record<string, unknown> = {}) {
	return {
		status: "active" as const,
		encryptedSecret: grantedSession,
		consentExpiresAt: new Date("2026-12-01T00:00:00Z"),
		lastSyncAt: null,
		automaticRetryAt: null,
		updatedAt: new Date("2026-09-01T00:00:00Z"),
		...overrides,
	};
}

describe("automatic bank synchronization", () => {
	it("does not sync an unfinished Enable Banking authorization", () => {
		expect(
			hasEnableBankingSession(
				encryptSecret(
					JSON.stringify({ state: "pending", authorizationId: "a" }),
				),
			),
		).toBe(false);
		expect(
			hasEnableBankingSession(
				encryptSecret(JSON.stringify({ sessionId: "s", accountUids: ["a"] })),
			),
		).toBe(true);
		expect(hasEnableBankingSession("broken-secret")).toBe(false);
	});
	it("does not retry an authorization the bank never completed", () => {
		// failEnableBankingConnection leaves the pending state behind as an
		// error row; the sync refuses it, so picking it is a failure every time.
		const unfinished = encryptSecret(
			JSON.stringify({ state: "pending", authorizationId: "a" }),
		);
		expect(
			isAutomaticSyncDue(
				connection({
					status: "error",
					encryptedSecret: unfinished,
					updatedAt: new Date(now.getTime() - AUTOMATIC_SYNC_ERROR_RETRY_MS),
				}),
				now,
			),
		).toBe(false);
		expect(
			isAutomaticSyncDue(connection({ encryptedSecret: "not-a-secret" }), now),
		).toBe(false);
	});

	it("syncs a connected account when Fortuna opens", () => {
		expect(isAutomaticSyncDue(connection(), now)).toBe(true);
	});

	it("does not hammer the provider on repeated page loads", () => {
		expect(
			isAutomaticSyncDue(
				connection({
					lastSyncAt: new Date(now.getTime() - PRESENT_SYNC_INTERVAL_MS + 1),
				}),
				now,
				PRESENT_SYNC_INTERVAL_MS,
			),
		).toBe(false);
	});

	it("paces a bank that will not accept the owner as present", () => {
		// Without presence headers every read counts against four a day, so the
		// short interval must not apply.
		const lastSyncAt = new Date(now.getTime() - PRESENT_SYNC_INTERVAL_MS * 2);
		expect(
			isAutomaticSyncDue(
				connection({ lastSyncAt }),
				now,
				PRESENT_SYNC_INTERVAL_MS,
			),
		).toBe(true);
		expect(
			isAutomaticSyncDue(
				connection({ lastSyncAt }),
				now,
				UNATTENDED_SYNC_INTERVAL_MS,
			),
		).toBe(false);
	});

	it("retries after the interval but never uses expired consent", () => {
		expect(
			isAutomaticSyncDue(
				connection({
					lastSyncAt: new Date(now.getTime() - UNATTENDED_SYNC_INTERVAL_MS),
				}),
				now,
			),
		).toBe(true);
		expect(
			isAutomaticSyncDue(
				connection({ consentExpiresAt: new Date("2026-09-15T11:59:59Z") }),
				now,
			),
		).toBe(false);
	});

	it("does not retry a failed provider on every page reload", () => {
		expect(
			isAutomaticSyncDue(
				connection({
					status: "error",
					updatedAt: new Date(
						now.getTime() - AUTOMATIC_SYNC_ERROR_RETRY_MS + 1,
					),
				}),
				now,
			),
		).toBe(false);
		expect(
			isAutomaticSyncDue(
				connection({
					status: "error",
					updatedAt: new Date(now.getTime() - AUTOMATIC_SYNC_ERROR_RETRY_MS),
				}),
				now,
			),
		).toBe(true);
	});
	it("waits for the provider's six-hour rate-limit cooldown", () => {
		const retryAt = new Date(
			now.getTime() + AUTOMATIC_SYNC_RATE_LIMIT_RETRY_MS,
		);
		expect(
			isAutomaticSyncDue(
				connection({ status: "error", automaticRetryAt: retryAt }),
				now,
			),
		).toBe(false);
		expect(
			isAutomaticSyncDue(
				connection({
					status: "error",
					automaticRetryAt: retryAt,
					updatedAt: new Date(now.getTime() - AUTOMATIC_SYNC_ERROR_RETRY_MS),
				}),
				retryAt,
			),
		).toBe(true);
	});
});
