import { createHash } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { Pool } from "pg";
import {
	disclosure,
	previewConfirmation,
	previewTradable,
	requiresAcknowledgement,
	validateOrderRequest,
} from "@/domain/broker-order";
import {
	normaliseSellReason,
	sellReasonProblem,
} from "@/domain/investment-rules";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { db } from "@/server/db";
import {
	brokerOrders,
	externalConnections,
	investmentSourceAccounts,
	investmentSourcePositions,
} from "@/server/db/schema";
import { logger } from "@/server/logger";
import type { DevicePrompt } from "@/server/providers/investment/scalable-hosted-cli";
import {
	beginScalableDeviceLogin,
	cancelScalableDeviceLogin,
	captureTradeConfirmation,
	closeTradeWorkspace,
	type PersistedTradeConfirmation,
	previewScalableTrade,
	restoreTradeWorkspace,
	revokeScalableCliSession,
	SCALABLE_TRADE_COMMAND_TIMEOUT_MS,
	type ScalableCliAuthFiles,
	ScalableCliError,
	submitScalableTrade,
	type TradeOrder,
} from "@/server/providers/investment/scalable-hosted-cli";
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
import { requestScalableHostedSync } from "./scalable-hosted";

/**
 * Orders at Scalable, placed by Fortuna only on the owner's explicit
 * confirmation — the owner's decision of 26.09.2026, with no amount limit and
 * only for instruments already in the depot.
 *
 * The trading session is a second, separate Scalable login without the
 * CLI's read-only guard. It is used for nothing but the two phases of an
 * order; every read keeps using the read-only connection. Everything here is
 * session-only: neither the Copilot nor an MCP client can reach it.
 */
const TRADING_PROVIDER = "scalable_trading_cli";
const SUBMISSION_UNKNOWN = "SUBMISSION_UNKNOWN";
const SUBMISSION_RESOLUTION_GRACE_MS = 15_000;
const MIN_SUBMISSION_RESOLUTION_DELAY_MS =
	SCALABLE_TRADE_COMMAND_TIMEOUT_MS + SUBMISSION_RESOLUTION_GRACE_MS;

type TradingSecret = { kind: "cli_session"; version: 1 } & ScalableCliAuthFiles;

declare global {
	// eslint-disable-next-line no-var
	var __fortunaTradingLockPool: Pool | undefined;
}

const tradingLockPool =
	globalThis.__fortunaTradingLockPool ??
	new Pool({
		connectionString: process.env.DATABASE_URL,
		max: 2,
		allowExitOnIdle: true,
	});
if (process.env.NODE_ENV !== "production")
	globalThis.__fortunaTradingLockPool = tradingLockPool;

/** Encrypted with the saved broker disclosure for cross-replica confirmation. */
type StoredTradePreview = {
	version: 1;
	preview: unknown;
} & PersistedTradeConfirmation;

function parseStoredTradePreview(encrypted: string | null): StoredTradePreview {
	if (!encrypted) throw new Error("Scalable preview is missing");
	const stored = JSON.parse(
		decryptSecret(encrypted),
	) as Partial<StoredTradePreview>;
	if (
		stored.version !== 1 ||
		typeof stored.confirmationId !== "string" ||
		!/^[A-Za-z0-9_-]{4,128}$/.test(stored.confirmationId) ||
		typeof stored.fileBase64 !== "string" ||
		stored.fileBase64.length === 0 ||
		stored.preview === undefined
	)
		throw new Error("Scalable preview is invalid");
	return stored as StoredTradePreview;
}

function orderFromRow(row: typeof brokerOrders.$inferSelect): TradeOrder {
	if (row.side === "buy" && row.amountMinor !== null)
		return { side: "buy", isin: row.isin, amountMinor: row.amountMinor };
	if (row.side === "sell" && row.shares !== null)
		return { side: "sell", isin: row.isin, shares: Number(row.shares) };
	throw new Error("Scalable order details are invalid");
}

/** One trading CLI operation per user across all web replicas. */
async function acquireTradingLock(
	userId: string,
	wait = false,
): Promise<() => Promise<void>> {
	const client = await tradingLockPool.connect();
	let acquired = false;
	let destroyed = false;
	const key = createHash("sha256")
		.update(`fortuna:scalable-trading:user:${userId}`)
		.digest()
		.readBigInt64BE(0)
		.toString();
	try {
		if (wait) {
			await client.query("select pg_advisory_lock($1::bigint)", [key]);
			acquired = true;
		} else {
			const result = await client.query<{ acquired: boolean }>(
				"select pg_try_advisory_lock($1::bigint) as acquired",
				[key],
			);
			acquired = result.rows[0]?.acquired === true;
		}
		if (!acquired)
			throw new ORPCError("CONFLICT", {
				message: "Es wird gerade schon eine Order bearbeitet.",
			});
		return async () => {
			try {
				if (acquired)
					await client.query("select pg_advisory_unlock($1::bigint)", [key]);
			} catch (error) {
				client.release(
					error instanceof Error ? error : new Error("Unlock failed"),
				);
				destroyed = true;
				throw error;
			} finally {
				if (!destroyed) client.release();
			}
		};
	} catch (error) {
		if (acquired) {
			try {
				await client.query("select pg_advisory_unlock($1::bigint)", [key]);
			} catch {
				client.release(
					error instanceof Error ? error : new Error("Unlock failed"),
				);
				destroyed = true;
			}
		}
		if (!destroyed) client.release();
		throw error;
	}
}

async function tradingConnection(userId: string) {
	return db.query.externalConnections.findFirst({
		where: and(
			eq(externalConnections.userId, userId),
			eq(externalConnections.provider, TRADING_PROVIDER),
		),
	});
}

function parseTradingSecret(encrypted: string): TradingSecret {
	const parsed = JSON.parse(decryptSecret(encrypted)) as TradingSecret;
	if (
		parsed.kind !== "cli_session" ||
		parsed.version !== 1 ||
		typeof parsed.session !== "string" ||
		typeof parsed.signingKey !== "string"
	)
		throw new Error("Scalable trading session is invalid");
	return parsed;
}

export function createTradingSessionRotationWriter(
	connectionId: string,
	initialEncryptedSecret: string,
) {
	let expectedEncryptedSecret = initialEncryptedSecret;
	return async (updated: ScalableCliAuthFiles) => {
		const nextEncryptedSecret = encryptSecret(
			JSON.stringify({
				kind: "cli_session",
				version: 1,
				...updated,
			} satisfies TradingSecret),
		);
		const saved = await db
			.update(externalConnections)
			.set({
				encryptedSecret: nextEncryptedSecret,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(externalConnections.id, connectionId),
					eq(externalConnections.status, "active"),
					eq(externalConnections.encryptedSecret, expectedEncryptedSecret),
				),
			)
			.returning({ id: externalConnections.id });
		if (!saved.length) throw new ScalableCliError("TRADING_SESSION_CHANGED");
		expectedEncryptedSecret = nextEncryptedSecret;
	};
}

function pruneExpired() {
	void db
		.update(brokerOrders)
		.set({ status: "expired", updatedAt: new Date() })
		.where(
			and(
				eq(brokerOrders.status, "previewed"),
				lt(brokerOrders.expiresAt, new Date()),
			),
		)
		.catch(() => undefined);
}

export async function tradingStatus(userId: string) {
	const [row, login] = await Promise.all([
		tradingConnection(userId),
		getScalableDeviceLoginStatus(userId, TRADING_PROVIDER),
	]);
	return {
		connected: Boolean(row?.encryptedSecret) && row?.status === "active",
		status: login.pending ? "pending" : (row?.status ?? "disconnected"),
		pendingLogin: login.prompt,
		lastError: row?.lastError ?? null,
	};
}

/** The owner starts this on purpose; it is the only login that may trade. */
export async function beginTradingLogin(userId: string) {
	const release = await acquireTradingLock(userId, true);
	let result: Awaited<ReturnType<typeof claimScalableDeviceLogin>>;
	try {
		if (await hasUnresolvedSubmission(userId))
			throw new ORPCError("CONFLICT", {
				message: "Eine Order muss noch mit Scalable abgeglichen werden.",
			});
		result = await claimScalableDeviceLogin(userId, TRADING_PROVIDER);
	} finally {
		await release();
	}
	if (result.kind === "existing_prompt") return result.prompt;
	if (result.kind === "starting")
		return waitForScalableDevicePrompt(
			userId,
			TRADING_PROVIDER,
			result.generation,
		);
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
			scalableLoginSlot(userId, TRADING_PROVIDER),
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
								} satisfies TradingSecret),
							),
							updatedAt: new Date(),
						})
						.where(
							and(
								eq(externalConnections.userId, userId),
								eq(externalConnections.provider, TRADING_PROVIDER),
							),
						)
						.returning({ id: externalConnections.id });
					if (!rows.length)
						throw new Error("Scalable trading connection is missing");
				});
				if (!saved) return false;
				logger.info("Scalable trading login completed", {
					event: "scalable.trading.login.completed",
				});
				return true;
			},
			async () => {
				await failScalableDeviceLogin(
					claim,
					"LOGIN_FAILED",
					"Die Handelsfreigabe ist fehlgeschlagen oder abgelaufen.",
				);
				logger.warn("Scalable trading login failed", {
					event: "scalable.trading.login.failed",
				});
			},
			{ readOnly: false, coordination },
		);
	} catch {
		await failScalableDeviceLogin(
			claim,
			"LOGIN_START_FAILED",
			"Scalable-Anmeldung konnte nicht gestartet werden.",
		).catch(() => undefined);
		throw new Error("Scalable-Anmeldung konnte nicht gestartet werden");
	}
}

export async function disconnectTrading(userId: string) {
	const release = await acquireTradingLock(userId);
	try {
		if (await hasUnresolvedSubmission(userId))
			throw new ORPCError("CONFLICT", {
				message: "Eine Order muss noch mit Scalable abgeglichen werden.",
			});
		await db
			.update(brokerOrders)
			.set({ status: "expired", updatedAt: new Date() })
			.where(
				and(
					eq(brokerOrders.userId, userId),
					eq(brokerOrders.status, "previewed"),
				),
			);
		const encryptedSecret = await cancelScalableDeviceLoginInDb(
			userId,
			TRADING_PROVIDER,
		);
		cancelScalableDeviceLogin(scalableLoginSlot(userId, TRADING_PROVIDER));
		if (encryptedSecret)
			await revokeScalableCliSession(parseTradingSecret(encryptedSecret)).catch(
				() =>
					logger.warn("Scalable trading logout could not be confirmed", {
						event: "scalable.trading.logout.unknown",
					}),
			);
	} finally {
		await release();
	}
}

/** What the depot holds now, from the read-only connection's last sync. */
async function heldInstruments(userId: string) {
	const accounts = await db
		.select({
			id: investmentSourceAccounts.id,
			currency: investmentSourceAccounts.currency,
		})
		.from(investmentSourceAccounts)
		.where(
			and(
				eq(investmentSourceAccounts.userId, userId),
				eq(investmentSourceAccounts.provider, "scalable"),
				eq(investmentSourceAccounts.method, "cli"),
				eq(investmentSourceAccounts.status, "active"),
			),
		);
	if (!accounts.length) return [];
	const rows = await db
		.select({
			isin: investmentSourcePositions.isin,
			name: investmentSourcePositions.instrumentName,
			quantity: investmentSourcePositions.quantity,
			currency: investmentSourcePositions.currency,
		})
		.from(investmentSourcePositions)
		.where(
			and(
				eq(investmentSourcePositions.userId, userId),
				inArray(
					investmentSourcePositions.accountId,
					accounts.map((account) => account.id),
				),
			),
		);
	return rows;
}

async function hasUnresolvedSubmission(userId: string): Promise<boolean> {
	return Boolean(
		await db.query.brokerOrders.findFirst({
			where: and(
				eq(brokerOrders.userId, userId),
				eq(brokerOrders.status, "submitting"),
			),
			columns: { id: true },
		}),
	);
}

function safeCode(error: unknown): string {
	if (error instanceof ScalableCliError) return error.code;
	if (error instanceof ORPCError) return error.code;
	return "ORDER_FAILED";
}

/** Owner-facing sentence for a failed phase; Fortuna's wording only. */
function failureMessage(error: unknown): string {
	if (error instanceof ScalableCliError) {
		if (error.needsLogin)
			return "Die Handelsfreigabe ist abgelaufen. Bitte unter Verbindungen neu freischalten.";
		if (
			error.exitStatus === 10 ||
			/VALIDATION|MISMATCH|UNSUITABLE/.test(error.code)
		)
			return `Scalable hat die Order abgelehnt (${error.code}).`;
		return `Scalable hat nicht geantwortet (${error.code}). Ob die Order angekommen ist, zeigt der nächste Abgleich.`;
	}
	return "Die Order konnte nicht bearbeitet werden.";
}

function definitelyNotAccepted(commandStarted: boolean): boolean {
	// v1.2.0 may submit before a later local/provider error is classified.
	// Once the CLI process spawned, only an external reconciliation can settle it.
	return !commandStarted;
}

function submissionUnknownMessage(): string {
	return "Scalable hat möglicherweise angenommen. Bitte erst dort prüfen und die Order nicht erneut absenden.";
}

export type OrderRequest =
	| { side: "buy"; isin: string; amountMinor: number }
	/** `reason` is the owner's "Warum jetzt?", required for every sale. */
	| { side: "sell"; isin: string; shares: number; reason: string };

/**
 * Phase 1: Scalable previews the order and hands out a confirmation. The
 * owner sees the whole disclosure; nothing is placed.
 */
async function previewOrderLocked(userId: string, request: OrderRequest) {
	pruneExpired();
	if (await hasUnresolvedSubmission(userId))
		throw new ORPCError("CONFLICT", {
			message: "Eine Order muss noch mit Scalable abgeglichen werden.",
		});
	// A sale is previewed only with the owner's own reason, the decision of
	// 28.09.2026; it is checked before anything reaches Scalable.
	const reasonRefusal =
		request.side === "sell" ? sellReasonProblem(request.reason) : null;
	if (reasonRefusal)
		throw new ORPCError("BAD_REQUEST", { message: reasonRefusal });
	const connection = await tradingConnection(userId);
	if (!connection?.encryptedSecret || connection.status !== "active")
		throw new ORPCError("PRECONDITION_FAILED", {
			message: "Der Handel ist noch nicht freigeschaltet (Verbindungen).",
		});
	const held = await heldInstruments(userId);
	const refusal = validateOrderRequest(
		request.side === "buy"
			? { side: "buy", isin: request.isin, amountMinor: request.amountMinor }
			: { side: "sell", isin: request.isin, shares: request.shares },
		held,
	);
	if (refusal) throw new ORPCError("BAD_REQUEST", { message: refusal });
	const holding = held.find((entry) => entry.isin === request.isin);
	const order: TradeOrder =
		request.side === "buy"
			? { side: "buy", isin: request.isin, amountMinor: request.amountMinor }
			: { side: "sell", isin: request.isin, shares: request.shares };
	const [row] = await db
		.insert(brokerOrders)
		.values({
			userId,
			side: request.side,
			isin: request.isin,
			instrumentName: holding?.name ?? request.isin,
			amountMinor: request.side === "buy" ? request.amountMinor : null,
			shares: request.side === "sell" ? request.shares : null,
			currency: holding?.currency ?? "EUR",
			sellReason:
				request.side === "sell" ? normaliseSellReason(request.reason) : null,
			status: "previewed",
		})
		.returning();
	try {
		const { preview, workspace } = await previewScalableTrade(
			parseTradingSecret(connection.encryptedSecret),
			order,
			createTradingSessionRotationWriter(
				connection.id,
				connection.encryptedSecret,
			),
		);
		let confirmation: ReturnType<typeof previewConfirmation>;
		let needsAck: boolean;
		try {
			confirmation = previewConfirmation(preview);
			if (!confirmation)
				throw new ScalableCliError("PREVIEW_WITHOUT_CONFIRMATION");
			const confirmationFileBase64 = await captureTradeConfirmation(
				workspace,
				confirmation.id,
			);
			needsAck = requiresAcknowledgement(preview);
			await db
				.update(brokerOrders)
				.set({
					requiresAcknowledgement: needsAck,
					encryptedPreview: encryptSecret(
						JSON.stringify({
							version: 1,
							preview,
							confirmationId: confirmation.id,
							fileBase64: confirmationFileBase64,
						} satisfies StoredTradePreview),
					),
					expiresAt: confirmation.expiresAt,
					updatedAt: new Date(),
				})
				.where(eq(brokerOrders.id, row.id));
		} finally {
			await closeTradeWorkspace(workspace);
		}
		logger.info("Scalable order previewed", {
			event: "scalable.trading.preview",
			orderId: row.id,
			side: request.side,
		});
		return {
			orderId: row.id,
			side: request.side,
			isin: request.isin,
			instrumentName: row.instrumentName,
			amountMinor: row.amountMinor,
			shares: row.shares,
			currency: row.currency,
			expiresAt: confirmation.expiresAt,
			requiresAcknowledgement: needsAck,
			tradable: previewTradable(preview),
			disclosure: disclosure(preview, request.side),
		};
	} catch (error) {
		await db
			.update(brokerOrders)
			.set({
				status: "failed",
				errorCode: safeCode(error),
				updatedAt: new Date(),
			})
			.where(eq(brokerOrders.id, row.id));
		logger.warn("Scalable order preview failed", {
			event: "scalable.trading.preview.failed",
			orderId: row.id,
			errorCode: safeCode(error),
		});
		throw new ORPCError("BAD_GATEWAY", { message: failureMessage(error) });
	}
}

export async function previewOrder(userId: string, request: OrderRequest) {
	const release = await acquireTradingLock(userId);
	try {
		return await previewOrderLocked(userId, request);
	} finally {
		await release();
	}
}

/**
 * Phase 2, only from the owner's explicit confirmation of a preview they
 * saw. A confirmation is used once; a second press finds the order already
 * past `previewed` and is refused.
 */
export async function submitOrder(
	userId: string,
	input: { orderId: string; acknowledged: boolean },
) {
	pruneExpired();
	const release = await acquireTradingLock(userId);
	try {
		if (await hasUnresolvedSubmission(userId))
			throw new ORPCError("CONFLICT", {
				message: "Eine Order muss noch mit Scalable abgeglichen werden.",
			});
		const row = await db.query.brokerOrders.findFirst({
			where: and(
				eq(brokerOrders.id, input.orderId),
				eq(brokerOrders.userId, userId),
			),
		});
		if (row?.status !== "previewed")
			throw new ORPCError("NOT_FOUND", {
				message:
					"Die Vorschau ist abgelaufen. Bitte die Order neu berechnen lassen.",
			});
		if (!row.expiresAt || row.expiresAt <= new Date())
			throw new ORPCError("NOT_FOUND", {
				message:
					"Die Vorschau ist abgelaufen. Bitte die Order neu berechnen lassen.",
			});
		if (row.requiresAcknowledgement && !input.acknowledged)
			throw new ORPCError("BAD_REQUEST", {
				message: "Der Warnhinweis muss erst bestätigt werden.",
			});
		const stored = parseStoredTradePreview(row.encryptedPreview);
		const order = orderFromRow(row);
		const claimed = await db
			.update(brokerOrders)
			.set({
				status: "submitting",
				acknowledged: input.acknowledged,
				confirmedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(brokerOrders.id, row.id),
					eq(brokerOrders.userId, userId),
					eq(brokerOrders.status, "previewed"),
					gt(brokerOrders.expiresAt, new Date()),
				),
			)
			.returning({ id: brokerOrders.id });
		if (!claimed.length)
			throw new ORPCError("CONFLICT", {
				message: "Diese Order wurde bereits bearbeitet.",
			});

		let commandStarted = false;
		try {
			const connection = await tradingConnection(userId);
			if (!connection?.encryptedSecret || connection.status !== "active")
				throw new ScalableCliError("TRADING_DISCONNECTED");
			const workspace = await restoreTradeWorkspace(
				parseTradingSecret(connection.encryptedSecret),
				order,
				{
					confirmationId: stored.confirmationId,
					fileBase64: stored.fileBase64,
				},
			);
			const result = await submitScalableTrade(
				workspace,
				order,
				stored.confirmationId,
				input.acknowledged,
				createTradingSessionRotationWriter(
					connection.id,
					connection.encryptedSecret,
				),
				() => {
					commandStarted = true;
				},
			);
			const submitted = await db
				.update(brokerOrders)
				.set({
					status: "submitted",
					encryptedResult: encryptSecret(JSON.stringify(result)),
					submittedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(brokerOrders.id, row.id),
						eq(brokerOrders.userId, userId),
						eq(brokerOrders.status, "submitting"),
					),
				)
				.returning({ id: brokerOrders.id });
			if (!submitted.length)
				throw new ORPCError("CONFLICT", {
					message: "Der Orderausgang wurde bereits abgeglichen.",
				});
			logger.info("Scalable order submitted", {
				event: "scalable.trading.submitted",
				orderId: row.id,
				side: row.side,
			});
			void requestScalableHostedSync(userId).catch(() => undefined);
			return { orderId: row.id, status: "submitted" as const };
		} catch (error) {
			const rejected = definitelyNotAccepted(commandStarted);
			const errorCode = rejected ? safeCode(error) : SUBMISSION_UNKNOWN;
			if (rejected) {
				await db
					.update(brokerOrders)
					.set({ status: "failed", errorCode, updatedAt: new Date() })
					.where(
						and(
							eq(brokerOrders.id, row.id),
							eq(brokerOrders.status, "submitting"),
						),
					);
				logger.warn("Scalable order submission rejected", {
					event: "scalable.trading.submit.rejected",
					orderId: row.id,
					errorCode,
				});
			} else {
				// Keep the order open until its outcome is checked at Scalable.
				await db
					.update(brokerOrders)
					.set({ errorCode, updatedAt: new Date() })
					.where(
						and(
							eq(brokerOrders.id, row.id),
							eq(brokerOrders.status, "submitting"),
						),
					)
					.catch(() => undefined);
				logger.warn("Scalable order outcome is unknown", {
					event: "scalable.trading.submit.unknown",
					orderId: row.id,
					errorCode,
				});
			}
			void requestScalableHostedSync(userId).catch(() => undefined);
			throw new ORPCError("BAD_GATEWAY", {
				message: rejected ? failureMessage(error) : submissionUnknownMessage(),
			});
		}
	} finally {
		await release();
	}
}

/** Record only the owner's check after an ambiguous submit; this never calls Scalable. */
export async function resolveUnknownSubmission(
	userId: string,
	input: { orderId: string; outcome: "found" | "not_found"; confirmed: true },
) {
	if (input.confirmed !== true)
		throw new ORPCError("BAD_REQUEST", {
			message: "Die Prüfung bei Scalable muss ausdrücklich bestätigt werden.",
		});
	const release = await acquireTradingLock(userId);
	try {
		const row = await db.query.brokerOrders.findFirst({
			where: and(
				eq(brokerOrders.id, input.orderId),
				eq(brokerOrders.userId, userId),
			),
		});
		if (
			row?.status !== "submitting" ||
			(row.errorCode !== null && row.errorCode !== SUBMISSION_UNKNOWN)
		)
			throw new ORPCError("CONFLICT", {
				message: "Für diese Order liegt kein offener, unklarer Ausgang vor.",
			});
		if (!row.confirmedAt)
			throw new ORPCError("PRECONDITION_FAILED", {
				message: "Der Ausführungsversuch muss erst abgeglichen werden.",
			});
		if (
			Date.now() - row.confirmedAt.getTime() <
			MIN_SUBMISSION_RESOLUTION_DELAY_MS
		)
			throw new ORPCError("PRECONDITION_FAILED", {
				message:
					"Der lokale Übermittlungsversuch könnte noch laufen. Bitte warten und danach den Status direkt bei Scalable prüfen.",
			});
		const status =
			input.outcome === "found"
				? ("owner_asserted_submitted" as const)
				: ("owner_asserted_not_submitted" as const);
		const resolved = await db
			.update(brokerOrders)
			.set({ status, errorCode: SUBMISSION_UNKNOWN, updatedAt: new Date() })
			.where(
				and(
					eq(brokerOrders.id, row.id),
					eq(brokerOrders.userId, userId),
					eq(brokerOrders.status, "submitting"),
				),
			)
			.returning({ id: brokerOrders.id });
		if (!resolved.length)
			throw new ORPCError("CONFLICT", {
				message: "Der Orderausgang wurde bereits abgeglichen.",
			});
		logger.info("Owner asserted Scalable order outcome", {
			event: "scalable.trading.outcome.owner_asserted",
			orderId: row.id,
			outcome: input.outcome,
		});
		return { orderId: row.id, status, assertionRecorded: true as const };
	} finally {
		await release();
	}
}

/** Drops a preview the owner decided against; nothing was placed. */
export async function discardPreview(userId: string, orderId: string) {
	await db
		.update(brokerOrders)
		.set({ status: "expired", updatedAt: new Date() })
		.where(
			and(
				eq(brokerOrders.id, orderId),
				eq(brokerOrders.userId, userId),
				eq(brokerOrders.status, "previewed"),
			),
		);
	return { discarded: true };
}

/** The order log, newest first; the broker's records stay encrypted. */
export async function listOrders(userId: string) {
	pruneExpired();
	const rows = await db
		.select({
			id: brokerOrders.id,
			side: brokerOrders.side,
			isin: brokerOrders.isin,
			instrumentName: brokerOrders.instrumentName,
			amountMinor: brokerOrders.amountMinor,
			shares: brokerOrders.shares,
			currency: brokerOrders.currency,
			status: brokerOrders.status,
			acknowledged: brokerOrders.acknowledged,
			sellReason: brokerOrders.sellReason,
			errorCode: brokerOrders.errorCode,
			createdAt: brokerOrders.createdAt,
			confirmedAt: brokerOrders.confirmedAt,
			submittedAt: brokerOrders.submittedAt,
		})
		.from(brokerOrders)
		.where(eq(brokerOrders.userId, userId))
		.orderBy(desc(brokerOrders.createdAt))
		.limit(50);
	return rows;
}

/** Test seam: forget in-memory previews. */
export function resetOpenPreviewsForTests() {
	// Previews are database-backed; there is no process-local state to reset.
}
