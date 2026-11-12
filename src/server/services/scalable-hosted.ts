import { and, eq, inArray } from "drizzle-orm";
import { todayIso } from "@/domain/dates";
import { computeMarketPulse } from "@/domain/scalable-market-pulse";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { db } from "@/server/db";
import {
	externalConnections,
	investmentSourceAccounts,
	investmentSourcePositions,
} from "@/server/db/schema";
import { logger } from "@/server/logger";
import {
	parseScalableHoldingsPulse,
	ScalableSnapshotError,
} from "@/server/providers/investment/scalable-cli";
import type { DevicePrompt } from "@/server/providers/investment/scalable-hosted-cli";
import {
	beginScalableDeviceLogin,
	cancelScalableDeviceLogin,
	readScalableBrokerSnapshot,
	readScalableHoldingsPulse,
	revokeScalableCliSession,
	type ScalableCliAuthFiles,
	ScalableCliError,
	VALIDATION_EXIT_STATUS,
} from "@/server/providers/investment/scalable-hosted-cli";
import {
	disconnectInvestmentSource,
	ingestScalableCliSnapshot,
	SCALABLE_INGEST_FAILED,
	ScalableIngestError,
	StaleScalableReadError,
} from "./investment-sources";
import { currentNetWorth } from "./net-worth";
import {
	cancelScalableDeviceLoginInDb,
	claimScalableDeviceLogin,
	completeScalableDeviceLogin,
	failScalableDeviceLogin,
	getScalableDeviceLoginStatus,
	persistScalableDevicePrompt,
	scalableDeviceLoginIsCurrent,
	scalableLoginSlot,
	waitForScalableDevicePrompt,
} from "./scalable-device-login";
import {
	claimScalableReadOperation,
	ScalableReadLockLostError,
	withScalableReadSessionLock,
} from "./scalable-read-lock";
import { getSettings, loadFxTable } from "./settings";

const PROVIDER = "scalable_hosted_cli";
type HostedSecret = {
	kind: "cli_session";
	version: 1;
	session: string;
	signingKey: string;
};
const runningSyncs = new Map<
	string,
	Promise<{ positions: number; imported: number; duplicates: number }>
>();
type MarketPulseResult = {
	status: "available" | "stale" | "unavailable" | "error";
	confirmedNetWorthMinor: number | null;
	indicativeNetWorthMinor: number | null;
	deltaMinor: number;
	currency: string;
	quotedAt: Date | null;
	checkedAt: Date;
	skipped: number;
	/**
	 * The quote moves of every comparable holding in its own currency, for the
	 * depot page. Holdings whose quantity changed or that lack a priced
	 * baseline are absent: they have no move to show.
	 */
	depot: {
		accountId: string;
		positions: Array<{ isin: string; deltaMinor: number; currency: string }>;
	} | null;
};
const runningPulses = new Map<string, Promise<MarketPulseResult>>();
const pulseFailures = new Map<string, number>();

function unavailablePulse(status: "unavailable" | "error"): MarketPulseResult {
	return {
		status,
		confirmedNetWorthMinor: null,
		indicativeNetWorthMinor: null,
		deltaMinor: 0,
		currency: "EUR",
		quotedAt: null,
		checkedAt: new Date(),
		skipped: 0,
		depot: null,
	};
}

/** Session-only route. A pulse never changes booked balances or net-worth history. */
export async function scalableMarketPulse(
	userId: string,
): Promise<MarketPulseResult> {
	if (runningSyncs.has(userId)) return unavailablePulse("unavailable");
	const running = runningPulses.get(userId);
	if (running) return running;
	const run = withScalableReadSessionLock(
		userId,
		async (lock): Promise<MarketPulseResult> => {
			const claim = await claimScalableReadOperation(userId, lock);
			if (!claim) return unavailablePulse("unavailable");
			const row = await connection(userId);
			if (
				!row?.encryptedSecret ||
				row.status !== "active" ||
				row.id !== claim.connectionId ||
				row.scalableReadGeneration !== claim.generation ||
				row.encryptedSecret !== claim.encryptedSecret
			)
				return unavailablePulse("unavailable");
			if (runningSyncs.has(userId)) return unavailablePulse("unavailable");
			if ((pulseFailures.get(userId) ?? 0) > Date.now() - 5 * 60_000)
				return unavailablePulse("error");
			try {
				const account = await db.query.investmentSourceAccounts.findFirst({
					where: and(
						eq(investmentSourceAccounts.userId, userId),
						eq(investmentSourceAccounts.provider, "scalable"),
						eq(investmentSourceAccounts.method, "cli"),
						eq(investmentSourceAccounts.status, "active"),
					),
				});
				if (
					!account ||
					account.portfolioValueMinor === null ||
					account.sourceAccountId.length < 8
				)
					return unavailablePulse("unavailable");
				await lock.assertHeld();
				const raw = await readScalableHoldingsPulse(
					parseSecret(row.encryptedSecret),
					saveScalableReadSessionRotation(
						row.id,
						row.encryptedSecret,
						claim.generation,
					),
				);
				await lock.assertHeld();
				const pulse = parseScalableHoldingsPulse(raw);
				if (account.sourceAccountId !== `broker:${pulse.portfolioId}`)
					throw new Error("Scalable pulse portfolio mismatch");
				if (account.encryptedRawMetadata) {
					const identity = JSON.parse(
						decryptSecret(account.encryptedRawMetadata),
					) as { accountId?: unknown };
					if (identity.accountId !== pulse.accountId)
						throw new Error("Scalable pulse account mismatch");
				}
				const currentConnection = await connection(userId);
				if (
					currentConnection?.status !== "active" ||
					currentConnection.scalableReadGeneration !== claim.generation
				)
					return unavailablePulse("unavailable");
				const [baseline, worth, settings, fx] = await Promise.all([
					db
						.select({
							isin: investmentSourcePositions.isin,
							quantity: investmentSourcePositions.quantity,
							currency: investmentSourcePositions.currency,
							valueMinor: investmentSourcePositions.valueMinor,
							valuationAt: investmentSourcePositions.valuationAt,
							valuationSource: investmentSourcePositions.valuationSource,
						})
						.from(investmentSourcePositions)
						.where(
							and(
								eq(investmentSourcePositions.userId, userId),
								eq(investmentSourcePositions.accountId, account.id),
							),
						),
					currentNetWorth(userId),
					getSettings(userId),
					loadFxTable(),
				]);
				const comparison = computeMarketPulse(
					baseline,
					pulse.positions,
					new Date(),
				);
				let deltaMinor = 0;
				let skipped = comparison.skipped;
				for (const mover of comparison.movers) {
					const converted = fx.convert(
						mover.deltaMinor,
						mover.currency,
						settings.baseCurrency,
						todayIso(),
					);
					if (converted.missing) {
						skipped++;
						continue;
					}
					deltaMinor += converted.amountMinor;
				}
				const indicative = worth.netWorthMinor + deltaMinor;
				const lastProviderQuoteAt = pulse.positions.reduce<Date | null>(
					(latest, holding) =>
						holding.quoteAt && (!latest || holding.quoteAt > latest)
							? holding.quoteAt
							: latest,
					null,
				);
				const result: MarketPulseResult = {
					status: comparison.latestQuoteAt ? "available" : "stale",
					confirmedNetWorthMinor: worth.netWorthMinor,
					indicativeNetWorthMinor: comparison.latestQuoteAt ? indicative : null,
					deltaMinor,
					currency: settings.baseCurrency,
					quotedAt: comparison.latestQuoteAt ?? lastProviderQuoteAt,
					checkedAt: new Date(),
					skipped,
					depot: comparison.latestQuoteAt
						? {
								accountId: account.id,
								positions: comparison.movers.map((mover) => ({
									isin: mover.isin,
									deltaMinor: mover.deltaMinor,
									currency: mover.currency,
								})),
							}
						: null,
				};
				await lock.assertHeld();
				const latestConnection = await connection(userId);
				if (
					latestConnection?.status !== "active" ||
					latestConnection.scalableReadGeneration !== claim.generation
				)
					return unavailablePulse("unavailable");
				pulseFailures.delete(userId);
				return result;
			} catch (error) {
				if (
					error instanceof ScalableReadLockLostError ||
					error instanceof StaleScalableReadError
				)
					return unavailablePulse("unavailable");
				pulseFailures.set(userId, Date.now());
				const failure = classifyScalableSyncFailure(error);
				logger.warn("Scalable market pulse failed", {
					event: "scalable.hosted.pulse.failed",
					errorCode: failure.errorCode,
					detail: failure.detail,
				});
				return unavailablePulse("error");
			}
		},
	);
	runningPulses.set(userId, run);
	try {
		return await run;
	} finally {
		runningPulses.delete(userId);
	}
}

function parseSecret(encrypted: string): HostedSecret {
	const parsed = JSON.parse(decryptSecret(encrypted)) as HostedSecret;
	if (
		parsed.kind !== "cli_session" ||
		parsed.version !== 1 ||
		typeof parsed.session !== "string" ||
		typeof parsed.signingKey !== "string"
	) {
		throw new Error("Scalable session state is invalid");
	}
	return parsed;
}

export function saveScalableReadSessionRotation(
	connectionId: string,
	initialEncryptedSecret: string,
	generation: number,
): (updated: ScalableCliAuthFiles) => Promise<void> {
	let expectedEncryptedSecret = initialEncryptedSecret;
	return async (updated) => {
		const nextEncryptedSecret = encryptSecret(
			JSON.stringify({
				kind: "cli_session",
				version: 1,
				...updated,
			} satisfies HostedSecret),
		);
		const saved = await db
			.update(externalConnections)
			.set({ encryptedSecret: nextEncryptedSecret })
			.where(
				and(
					eq(externalConnections.id, connectionId),
					eq(externalConnections.scalableReadGeneration, generation),
					eq(externalConnections.encryptedSecret, expectedEncryptedSecret),
					inArray(externalConnections.status, ["active", "error"]),
				),
			)
			.returning({ id: externalConnections.id });
		if (!saved.length)
			throw new Error("Scalable session rotated on another replica");
		expectedEncryptedSecret = nextEncryptedSecret;
	};
}

async function connection(userId: string) {
	return db.query.externalConnections.findFirst({
		where: and(
			eq(externalConnections.userId, userId),
			eq(externalConnections.provider, PROVIDER),
		),
	});
}

export async function scalableHostedStatus(userId: string) {
	const [row, login] = await Promise.all([
		connection(userId),
		getScalableDeviceLoginStatus(userId, PROVIDER),
	]);
	return {
		configured: Boolean(row?.encryptedSecret && row.status !== "disconnected"),
		status: login.pending ? "pending" : (row?.status ?? "disconnected"),
		pending: login.pending,
		syncing: runningSyncs.has(userId),
		lastSyncAt: row?.lastSyncAt ?? null,
		lastAttemptedSyncAt: row?.lastAttemptedSyncAt ?? null,
		lastError: row?.lastError ?? null,
	};
}

export async function beginScalableHostedConnection(userId: string) {
	const result = await claimScalableDeviceLogin(userId, PROVIDER);
	if (result.kind === "existing_prompt") return result.prompt;
	if (result.kind === "starting")
		return waitForScalableDevicePrompt(userId, PROVIDER, result.generation);
	const { claim } = result;
	const coordination = {
		workerId: claim.workerId,
		generation: claim.generation,
		onPrompt: (prompt: DevicePrompt) =>
			persistScalableDevicePrompt(claim, prompt),
		isCurrent: () => scalableDeviceLoginIsCurrent(claim),
	};
	try {
		return await beginScalableDeviceLogin(
			scalableLoginSlot(userId, PROVIDER),
			async (auth) => {
				const saved = await completeScalableDeviceLogin(claim, async (tx) => {
					const rows = await tx
						.update(externalConnections)
						.set({
							status: "active",
							lastError: null,
							encryptedSecret: encryptSecret(
								JSON.stringify({
									kind: "cli_session",
									version: 1,
									...auth,
								} satisfies HostedSecret),
							),
							updatedAt: new Date(),
						})
						.where(
							and(
								eq(externalConnections.userId, userId),
								eq(externalConnections.provider, PROVIDER),
							),
						)
						.returning({ id: externalConnections.id });
					if (!rows.length)
						throw new Error("Scalable read connection is missing");
				});
				if (!saved) return false;
				logger.info("Scalable device login completed", {
					event: "scalable.hosted.login.completed",
				});
				void syncScalableHostedConnection(userId).catch(() => undefined);
				return true;
			},
			async () => {
				await failScalableDeviceLogin(
					claim,
					"LOGIN_FAILED",
					"Scalable-Anmeldung fehlgeschlagen oder abgelaufen",
				);
				logger.warn("Scalable device login failed", {
					event: "scalable.hosted.login.failed",
				});
			},
			{ coordination },
		);
	} catch {
		await failScalableDeviceLogin(
			claim,
			"LOGIN_START_FAILED",
			"Scalable-Anmeldung konnte nicht gestartet werden",
		).catch(() => undefined);
		throw new Error("Scalable-Anmeldung konnte nicht gestartet werden");
	}
}

export type ScalableSyncFailure = {
	/** Stable, safe to log: never a provider message. */
	errorCode: string;
	/** The validation label for a rejected snapshot — Fortuna's own words. */
	detail: string | null;
	/** What the owner sees: whether to reconnect, wait, or leave it to Fortuna. */
	ownerMessage: string;
};

const KEEPS_LAST = "Der letzte Bestand bleibt erhalten.";

/**
 * Turns a sync failure into a code worth logging and a sentence worth
 * showing. Three situations need three different answers from the owner:
 * an expired session (reconnect), a snapshot Fortuna could not read (nothing
 * to do, Fortuna has to adapt) and a provider that is simply not answering
 * (wait; the next automatic attempt is an hour away).
 */
export function classifyScalableSyncFailure(
	error: unknown,
): ScalableSyncFailure {
	if (error instanceof ScalableSnapshotError)
		return {
			errorCode: "SNAPSHOT_INVALID",
			detail: error.message,
			ownerMessage: `Scalable liefert Daten in einer Form, die Fortuna nicht verarbeiten kann. ${KEEPS_LAST}`,
		};
	if (error instanceof ScalableIngestError)
		return {
			errorCode: error.code,
			detail: null,
			ownerMessage: SCALABLE_INGEST_FAILED,
		};
	if (error instanceof ScalableCliError) {
		if (error.needsLogin)
			return {
				errorCode: error.code,
				detail: null,
				ownerMessage: `Die Scalable-Anmeldung ist abgelaufen. Bitte neu verbinden. ${KEEPS_LAST}`,
			};
		// Exit 10 means Scalable refused the request as Fortuna phrased it.
		// Neither waiting nor reconnecting helps; Fortuna has to change.
		if (
			error.exitStatus === VALIDATION_EXIT_STATUS ||
			error.code === "CLI_VALIDATION_ERROR"
		)
			return {
				errorCode: error.code,
				detail: null,
				ownerMessage: `Scalable hat die Abfrage von Fortuna als ungültig abgelehnt. Das liegt an Fortuna, nicht an der Verbindung. ${KEEPS_LAST}`,
			};
		// The program is missing or answered beyond Fortuna's size limit: a
		// problem on Fortuna's side that no retry in an hour will fix.
		if (error.code === "CLI_NOT_FOUND")
			return {
				errorCode: error.code,
				detail: null,
				ownerMessage: `Fortuna kann Scalable auf dem Server gerade nicht abfragen. ${KEEPS_LAST}`,
			};
		if (error.code === "CLI_OUTPUT_TOO_LARGE")
			return {
				errorCode: error.code,
				detail: null,
				ownerMessage: `Scalable liefert mehr Daten, als Fortuna verarbeiten kann. ${KEEPS_LAST}`,
			};
		return {
			errorCode: error.code,
			detail: null,
			ownerMessage: `Scalable ist gerade nicht erreichbar; der nächste automatische Versuch folgt in einer Stunde. ${KEEPS_LAST}`,
		};
	}
	return {
		errorCode: "SYNC_FAILED",
		detail: null,
		ownerMessage: `Scalable-Abgleich fehlgeschlagen. ${KEEPS_LAST}`,
	};
}

export async function syncScalableHostedConnection(userId: string) {
	const existing = runningSyncs.get(userId);
	if (existing) return existing;
	const run = withScalableReadSessionLock(userId, async (lock) => {
		const claim = await claimScalableReadOperation(userId, lock);
		if (!claim) throw new Error("Scalable ist nicht verbunden");
		const row = await connection(userId);
		if (
			!row?.encryptedSecret ||
			(row.status !== "active" && row.status !== "error") ||
			row.id !== claim.connectionId ||
			row.scalableReadGeneration !== claim.generation ||
			row.encryptedSecret !== claim.encryptedSecret
		)
			throw new StaleScalableReadError();
		const secret = parseSecret(claim.encryptedSecret);
		try {
			await lock.assertHeld();
			const attempted = await db
				.update(externalConnections)
				.set({ lastAttemptedSyncAt: new Date(), lastError: null })
				.where(
					and(
						eq(externalConnections.id, row.id),
						eq(externalConnections.scalableReadGeneration, claim.generation),
						inArray(externalConnections.status, ["active", "error"]),
					),
				)
				.returning({ id: externalConnections.id });
			if (!attempted.length) throw new StaleScalableReadError();
			const bundle = await readScalableBrokerSnapshot(
				secret as ScalableCliAuthFiles,
				saveScalableReadSessionRotation(
					row.id,
					claim.encryptedSecret,
					claim.generation,
				),
			);
			await lock.assertHeld();
			const current = await connection(userId);
			if (
				(current?.status !== "active" && current?.status !== "error") ||
				current.scalableReadGeneration !== claim.generation
			)
				throw new StaleScalableReadError();
			const result = await ingestScalableCliSnapshot(userId, bundle, {
				connectionId: row.id,
				generation: claim.generation,
			});
			const warning = result.warning;
			const completed = await db
				.update(externalConnections)
				.set({ status: "active", lastSyncAt: new Date(), lastError: warning })
				.where(
					and(
						eq(externalConnections.id, row.id),
						eq(externalConnections.scalableReadGeneration, claim.generation),
						inArray(externalConnections.status, ["active", "error"]),
					),
				)
				.returning({ id: externalConnections.id });
			if (!completed.length) throw new StaleScalableReadError();
			logger.info("Scalable hosted sync completed", {
				event: "scalable.hosted.sync.completed",
				positions: result.positions,
				imported: result.imported,
				revised: result.revised,
				conflicts: result.conflicts,
			});
			return result;
		} catch (error) {
			if (
				error instanceof StaleScalableReadError ||
				error instanceof ScalableReadLockLostError
			) {
				throw new Error("Scalable-Abgleich fehlgeschlagen");
			}
			const failure = classifyScalableSyncFailure(error);
			await db
				.update(externalConnections)
				.set({ status: "error", lastError: failure.ownerMessage })
				.where(
					and(
						eq(externalConnections.id, row.id),
						eq(externalConnections.scalableReadGeneration, claim.generation),
						inArray(externalConnections.status, ["active", "error"]),
					),
				);
			logger.warn("Scalable hosted sync failed", {
				event: "scalable.hosted.sync.failed",
				errorCode: failure.errorCode,
				detail: failure.detail,
			});
			throw new Error("Scalable-Abgleich fehlgeschlagen");
		}
	});
	runningSyncs.set(userId, run);
	try {
		return await run;
	} finally {
		runningSyncs.delete(userId);
	}
}

/** Return promptly; the browser polls status while the bounded read completes. */
export async function requestScalableHostedSync(userId: string) {
	const row = await connection(userId);
	if (
		!row?.encryptedSecret ||
		row.status === "pending" ||
		row.status === "disconnected"
	)
		throw new Error("Scalable ist nicht verbunden");
	if (runningSyncs.has(userId)) return { started: false };
	void syncScalableHostedConnection(userId).catch(() => undefined);
	return { started: true };
}

export async function syncScalableHostedDue(userId: string) {
	const row = await connection(userId);
	if (
		!row?.encryptedSecret ||
		row.status === "pending" ||
		row.status === "disconnected"
	)
		return { attempted: false };
	const now = Date.now();
	if (row.lastSyncAt && now - row.lastSyncAt.getTime() < 15 * 60_000)
		return { attempted: false };
	if (
		row.status === "error" &&
		row.lastAttemptedSyncAt &&
		now - row.lastAttemptedSyncAt.getTime() < 60 * 60_000
	)
		return { attempted: false };
	const requested = await requestScalableHostedSync(userId);
	return { attempted: requested.started };
}

export async function disconnectScalableHosted(userId: string) {
	pulseFailures.delete(userId);
	const encryptedSecret = await withScalableReadSessionLock(
		userId,
		async () => {
			const secret = await cancelScalableDeviceLoginInDb(userId, PROVIDER);
			cancelScalableDeviceLogin(scalableLoginSlot(userId, PROVIDER));
			return secret;
		},
	);
	if (encryptedSecret) {
		try {
			await revokeScalableCliSession(parseSecret(encryptedSecret));
		} catch {
			logger.warn("Scalable provider logout could not be confirmed", {
				event: "scalable.hosted.logout.unknown",
			});
		}
	}
	await disconnectInvestmentSource(userId);
	logger.info("Scalable hosted session removed", {
		event: "scalable.hosted.disconnected",
	});
}
