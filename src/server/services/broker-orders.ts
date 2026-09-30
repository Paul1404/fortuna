import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
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
import {
	beginScalableDeviceLogin,
	cancelScalableDeviceLogin,
	closeTradeWorkspace,
	pendingScalableLogin,
	previewScalableTrade,
	revokeScalableCliSession,
	type ScalableCliAuthFiles,
	ScalableCliError,
	submitScalableTrade,
	type TradeOrder,
	type TradeWorkspace,
	tradingLoginSlot,
} from "@/server/providers/investment/scalable-hosted-cli";
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

type TradingSecret = { kind: "cli_session"; version: 1 } & ScalableCliAuthFiles;

/** A previewed order's confirmation, kept in memory until phase 2 or expiry. */
const openPreviews = new Map<
	string,
	{
		userId: string;
		order: TradeOrder;
		workspace: TradeWorkspace;
		confirmationId: string;
		expiresAt: number;
	}
>();
const runningOrders = new Set<string>();

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

function storeRotated(connectionId: string) {
	return async (updated: ScalableCliAuthFiles) => {
		await db
			.update(externalConnections)
			.set({
				encryptedSecret: encryptSecret(
					JSON.stringify({
						kind: "cli_session",
						version: 1,
						...updated,
					} satisfies TradingSecret),
				),
				updatedAt: new Date(),
			})
			.where(eq(externalConnections.id, connectionId));
	};
}

function pruneExpired(now = Date.now()) {
	for (const [id, entry] of openPreviews)
		if (entry.expiresAt <= now) {
			openPreviews.delete(id);
			void closeTradeWorkspace(entry.workspace).catch(() => undefined);
			void db
				.update(brokerOrders)
				.set({ status: "expired", updatedAt: new Date() })
				.where(
					and(eq(brokerOrders.id, id), eq(brokerOrders.status, "previewed")),
				)
				.catch(() => undefined);
		}
}

export async function tradingStatus(userId: string) {
	const row = await tradingConnection(userId);
	return {
		connected: Boolean(row?.encryptedSecret) && row?.status === "active",
		status: row?.status ?? "disconnected",
		pendingLogin: pendingScalableLogin(tradingLoginSlot(userId)),
		lastError: row?.lastError ?? null,
	};
}

/** The owner starts this on purpose; it is the only login that may trade. */
export async function beginTradingLogin(userId: string) {
	const slot = tradingLoginSlot(userId);
	const existing = pendingScalableLogin(slot);
	if (existing) return existing;
	await db
		.insert(externalConnections)
		.values({
			userId,
			provider: TRADING_PROVIDER,
			status: "pending",
			lastError: null,
		})
		.onConflictDoUpdate({
			target: [externalConnections.userId, externalConnections.provider],
			set: { status: "pending", lastError: null, updatedAt: new Date() },
		});
	return beginScalableDeviceLogin(
		slot,
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
						} satisfies TradingSecret),
					),
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(externalConnections.userId, userId),
						eq(externalConnections.provider, TRADING_PROVIDER),
						eq(externalConnections.status, "pending"),
					),
				)
				.returning({ id: externalConnections.id });
			if (!saved.length) {
				await revokeScalableCliSession(auth).catch(() => undefined);
				return;
			}
			logger.info("Scalable trading login completed", {
				event: "scalable.trading.login.completed",
			});
		},
		async () => {
			await db
				.update(externalConnections)
				.set({
					status: "error",
					lastError: "Die Handelsfreigabe ist fehlgeschlagen oder abgelaufen.",
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(externalConnections.userId, userId),
						eq(externalConnections.provider, TRADING_PROVIDER),
						eq(externalConnections.status, "pending"),
					),
				);
			logger.warn("Scalable trading login failed", {
				event: "scalable.trading.login.failed",
			});
		},
		{ readOnly: false },
	);
}

export async function disconnectTrading(userId: string) {
	cancelScalableDeviceLogin(tradingLoginSlot(userId));
	for (const [id, entry] of openPreviews)
		if (entry.userId === userId) {
			openPreviews.delete(id);
			await closeTradeWorkspace(entry.workspace).catch(() => undefined);
		}
	const row = await tradingConnection(userId);
	if (row?.encryptedSecret)
		await revokeScalableCliSession(
			parseTradingSecret(row.encryptedSecret),
		).catch(() =>
			logger.warn("Scalable trading logout could not be confirmed", {
				event: "scalable.trading.logout.unknown",
			}),
		);
	await db
		.update(externalConnections)
		.set({ status: "disconnected", encryptedSecret: null, lastError: null })
		.where(
			and(
				eq(externalConnections.userId, userId),
				eq(externalConnections.provider, TRADING_PROVIDER),
			),
		);
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

export type OrderRequest =
	| { side: "buy"; isin: string; amountMinor: number }
	/** `reason` is the owner's "Warum jetzt?", required for every sale. */
	| { side: "sell"; isin: string; shares: number; reason: string };

/**
 * Phase 1: Scalable previews the order and hands out a confirmation. The
 * owner sees the whole disclosure; nothing is placed.
 */
export async function previewOrder(userId: string, request: OrderRequest) {
	pruneExpired();
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
			storeRotated(connection.id),
		);
		const confirmation = previewConfirmation(preview);
		if (!confirmation) {
			await closeTradeWorkspace(workspace);
			throw new ScalableCliError("PREVIEW_WITHOUT_CONFIRMATION");
		}
		const needsAck = requiresAcknowledgement(preview);
		await db
			.update(brokerOrders)
			.set({
				requiresAcknowledgement: needsAck,
				encryptedPreview: encryptSecret(JSON.stringify(preview)),
				expiresAt: confirmation.expiresAt,
				updatedAt: new Date(),
			})
			.where(eq(brokerOrders.id, row.id));
		openPreviews.set(row.id, {
			userId,
			order,
			workspace,
			confirmationId: confirmation.id,
			expiresAt: confirmation.expiresAt.getTime(),
		});
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
	const open = openPreviews.get(input.orderId);
	const row = await db.query.brokerOrders.findFirst({
		where: and(
			eq(brokerOrders.id, input.orderId),
			eq(brokerOrders.userId, userId),
		),
	});
	if (!row || !open || open.userId !== userId)
		throw new ORPCError("NOT_FOUND", {
			message:
				"Die Vorschau ist abgelaufen. Bitte die Order neu berechnen lassen.",
		});
	if (row.requiresAcknowledgement && !input.acknowledged)
		throw new ORPCError("BAD_REQUEST", {
			message: "Der Warnhinweis muss erst bestätigt werden.",
		});
	if (runningOrders.has(userId))
		throw new ORPCError("CONFLICT", {
			message: "Es wird gerade schon eine Order übermittelt.",
		});
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
			),
		)
		.returning({ id: brokerOrders.id });
	if (!claimed.length)
		throw new ORPCError("CONFLICT", {
			message: "Diese Order wurde bereits bearbeitet.",
		});
	openPreviews.delete(row.id);
	runningOrders.add(userId);
	const connection = await tradingConnection(userId);
	try {
		if (!connection) throw new ScalableCliError("TRADING_DISCONNECTED");
		const result = await submitScalableTrade(
			open.workspace,
			open.order,
			open.confirmationId,
			input.acknowledged,
			storeRotated(connection.id),
		);
		await db
			.update(brokerOrders)
			.set({
				status: "submitted",
				encryptedResult: encryptSecret(JSON.stringify(result)),
				submittedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(brokerOrders.id, row.id));
		logger.info("Scalable order submitted", {
			event: "scalable.trading.submitted",
			orderId: row.id,
			side: row.side,
		});
		// Read the depot back so the order shows up where the owner looks.
		void requestScalableHostedSync(userId).catch(() => undefined);
		return { orderId: row.id, status: "submitted" as const };
	} catch (error) {
		await db
			.update(brokerOrders)
			.set({
				status: "failed",
				errorCode: safeCode(error),
				updatedAt: new Date(),
			})
			.where(eq(brokerOrders.id, row.id));
		logger.warn("Scalable order submission failed", {
			event: "scalable.trading.submit.failed",
			orderId: row.id,
			errorCode: safeCode(error),
		});
		// An unclear answer may still have reached Scalable: read back.
		void requestScalableHostedSync(userId).catch(() => undefined);
		throw new ORPCError("BAD_GATEWAY", { message: failureMessage(error) });
	} finally {
		runningOrders.delete(userId);
	}
}

/** Drops a preview the owner decided against; nothing was placed. */
export async function discardPreview(userId: string, orderId: string) {
	const open = openPreviews.get(orderId);
	if (open && open.userId === userId) {
		openPreviews.delete(orderId);
		await closeTradeWorkspace(open.workspace).catch(() => undefined);
	}
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
	for (const entry of openPreviews.values())
		void closeTradeWorkspace(entry.workspace).catch(() => undefined);
	openPreviews.clear();
	runningOrders.clear();
}
