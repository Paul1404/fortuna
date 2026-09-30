import { and, eq, inArray } from "drizzle-orm";
import { todayIso } from "@/domain/dates";
import { computeMarketPulse } from "@/domain/scalable-market-pulse";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { dataRevision } from "@/server/data-revision";
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
import {
	beginScalableDeviceLogin,
	cancelScalableDeviceLogin,
	pendingScalableLogin,
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
} from "./investment-sources";
import { currentNetWorth } from "./net-worth";
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
const pulseCache = new Map<
	string,
	{ expiresAt: number; revision: number; result: MarketPulseResult }
>();
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
	const cached = pulseCache.get(userId);
	if (
		cached &&
		cached.expiresAt > Date.now() &&
		cached.revision === dataRevision(userId)
	)
		return cached.result;
	const running = runningPulses.get(userId);
	if (running) return running;
	const run = (async (): Promise<MarketPulseResult> => {
		const row = await connection(userId);
		if (!row?.encryptedSecret || row.status !== "active")
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
			const raw = await readScalableHoldingsPulse(
				parseSecret(row.encryptedSecret),
				async (updated) => {
					const saved = await db
						.update(externalConnections)
						.set({
							encryptedSecret: encryptSecret(
								JSON.stringify({
									kind: "cli_session",
									version: 1,
									...updated,
								} satisfies HostedSecret),
							),
						})
						.where(
							and(
								eq(externalConnections.id, row.id),
								eq(externalConnections.status, "active"),
							),
						)
						.returning({ id: externalConnections.id });
					if (!saved.length) throw new Error("Scalable session disconnected");
				},
			);
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
			if (currentConnection?.status !== "active")
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
			pulseCache.set(userId, {
				result,
				// One read per ticker interval (15 s); every subscriber shares it.
				expiresAt: Date.now() + 14_000,
				revision: dataRevision(userId),
			});
			pulseFailures.delete(userId);
			return result;
		} catch (error) {
			pulseFailures.set(userId, Date.now());
			const failure = classifyScalableSyncFailure(error);
			logger.warn("Scalable market pulse failed", {
				event: "scalable.hosted.pulse.failed",
				errorCode: failure.errorCode,
				detail: failure.detail,
			});
			return unavailablePulse("error");
		}
	})();
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

async function connection(userId: string) {
	return db.query.externalConnections.findFirst({
		where: and(
			eq(externalConnections.userId, userId),
			eq(externalConnections.provider, PROVIDER),
		),
	});
}

export async function scalableHostedStatus(userId: string) {
	const row = await connection(userId);
	return {
		configured: Boolean(row?.encryptedSecret && row.status !== "disconnected"),
		status: row?.status ?? "disconnected",
		pending: Boolean(pendingScalableLogin(userId)),
		syncing: runningSyncs.has(userId),
		lastSyncAt: row?.lastSyncAt ?? null,
		lastAttemptedSyncAt: row?.lastAttemptedSyncAt ?? null,
		lastError: row?.lastError ?? null,
	};
}

export async function beginScalableHostedConnection(userId: string) {
	const existing = pendingScalableLogin(userId);
	if (existing) return existing;
	await db
		.insert(externalConnections)
		.values({ userId, provider: PROVIDER, status: "pending", lastError: null })
		.onConflictDoUpdate({
			target: [externalConnections.userId, externalConnections.provider],
			set: { status: "pending", lastError: null, updatedAt: new Date() },
		});
	try {
		return await beginScalableDeviceLogin(
			userId,
			async (auth) => {
				const saved = await db
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
							eq(externalConnections.status, "pending"),
						),
					)
					.returning({ id: externalConnections.id });
				if (!saved.length) {
					await revokeScalableCliSession(auth).catch(() => undefined);
					return;
				}
				logger.info("Scalable device login completed", {
					event: "scalable.hosted.login.completed",
				});
				void syncScalableHostedConnection(userId).catch(() => undefined);
			},
			async () => {
				await db
					.update(externalConnections)
					.set({
						status: "error",
						lastError: "Scalable-Anmeldung fehlgeschlagen oder abgelaufen",
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(externalConnections.userId, userId),
							eq(externalConnections.provider, PROVIDER),
							eq(externalConnections.status, "pending"),
						),
					);
				logger.warn("Scalable device login failed", {
					event: "scalable.hosted.login.failed",
				});
			},
		);
	} catch {
		await db
			.update(externalConnections)
			.set({
				status: "error",
				lastError: "Scalable-Anmeldung konnte nicht gestartet werden",
			})
			.where(
				and(
					eq(externalConnections.userId, userId),
					eq(externalConnections.provider, PROVIDER),
				),
			);
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
	const run = (async () => {
		// CLI refresh tokens must not be rotated by two concurrent workspaces.
		const pulse = runningPulses.get(userId);
		if (pulse) await pulse;
		const row = await connection(userId);
		if (!row?.encryptedSecret || row.status === "disconnected")
			throw new Error("Scalable ist nicht verbunden");
		const secret = parseSecret(row.encryptedSecret);
		await db
			.update(externalConnections)
			.set({ lastAttemptedSyncAt: new Date(), lastError: null })
			.where(eq(externalConnections.id, row.id));
		try {
			const bundle = await readScalableBrokerSnapshot(
				secret as ScalableCliAuthFiles,
				async (updated) => {
					const saved = await db
						.update(externalConnections)
						.set({
							encryptedSecret: encryptSecret(
								JSON.stringify({
									kind: "cli_session",
									version: 1,
									...updated,
								} satisfies HostedSecret),
							),
						})
						.where(
							and(
								eq(externalConnections.id, row.id),
								inArray(externalConnections.status, ["active", "error"]),
							),
						)
						.returning({ id: externalConnections.id });
					if (!saved.length)
						throw new Error("Scalable-Verbindung wurde getrennt");
				},
			);
			const current = await connection(userId);
			if (current?.status !== "active" && current?.status !== "error")
				throw new Error("Scalable-Verbindung wurde getrennt");
			const result = await ingestScalableCliSnapshot(userId, bundle);
			pulseCache.delete(userId);
			const warning = result.warning;
			await db
				.update(externalConnections)
				.set({ status: "active", lastSyncAt: new Date(), lastError: warning })
				.where(
					and(
						eq(externalConnections.id, row.id),
						inArray(externalConnections.status, ["active", "error"]),
					),
				);
			logger.info("Scalable hosted sync completed", {
				event: "scalable.hosted.sync.completed",
				positions: result.positions,
				imported: result.imported,
				revised: result.revised,
				conflicts: result.conflicts,
			});
			return result;
		} catch (error) {
			const failure = classifyScalableSyncFailure(error);
			await db
				.update(externalConnections)
				.set({ status: "error", lastError: failure.ownerMessage })
				.where(
					and(
						eq(externalConnections.id, row.id),
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
	})();
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
	pulseCache.delete(userId);
	pulseFailures.delete(userId);
	cancelScalableDeviceLogin(userId);
	const row = await connection(userId);
	if (row?.encryptedSecret) {
		try {
			await revokeScalableCliSession(parseSecret(row.encryptedSecret));
		} catch {
			logger.warn("Scalable provider logout could not be confirmed", {
				event: "scalable.hosted.logout.unknown",
			});
		}
	}
	await db
		.update(externalConnections)
		.set({ status: "disconnected", encryptedSecret: null, lastError: null })
		.where(
			and(
				eq(externalConnections.userId, userId),
				eq(externalConnections.provider, PROVIDER),
			),
		);
	await disconnectInvestmentSource(userId);
	logger.info("Scalable hosted session removed", {
		event: "scalable.hosted.disconnected",
	});
}
