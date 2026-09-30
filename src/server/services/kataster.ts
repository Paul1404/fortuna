import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { and, eq } from "drizzle-orm";
import * as v from "valibot";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { db } from "@/server/db";
import { externalConnections } from "@/server/db/schema";
import { logger } from "@/server/logger";
import {
	providerErrorClass,
	providerHttpStatus,
	safeProviderMessage,
} from "@/server/provider-errors";

const PROVIDER = "kataster";
export const DEFAULT_KATASTER_URL = "https://kataster.pdcd.net";

const marginSchema = v.object({
	period: v.string(),
	rows: v.array(
		v.object({
			customerId: v.string(),
			name: v.string(),
			costCents: v.number(),
			chargeCents: v.number(),
			marginCents: v.number(),
		}),
	),
	unallocatedCostCents: v.number(),
	totalCostCents: v.number(),
	totalChargeCents: v.number(),
	totalMarginCents: v.number(),
});
const overviewSchema = v.object({
	assetStatus: v.record(v.string(), v.number()),
	openIncidents: v.number(),
	resources: v.number(),
	workerAlive: v.boolean(),
});
const readinessSchema = v.object({
	period: v.string(),
	unassigned: v.array(v.unknown()),
	unpriced: v.array(v.unknown()),
	uncoveredPools: v.array(v.unknown()),
	ready: v.boolean(),
});

type KatasterSecret = { token: string };

export class KatasterConnectionError extends Error {}

function normalizeBaseUrl(value: string): string {
	try {
		const url = new URL(value.trim());
		if (url.protocol !== "https:" || url.username || url.password)
			throw new Error();
		url.pathname = url.pathname.replace(/\/+$/, "");
		url.search = "";
		url.hash = "";
		return url.toString().replace(/\/$/, "");
	} catch {
		throw new KatasterConnectionError(
			"Bitte eine gültige HTTPS-Adresse angeben",
		);
	}
}

async function callJson(
	client: Client,
	name: string,
	args: Record<string, unknown>,
) {
	const result = await client.callTool({ name, arguments: args });
	if (result.isError) throw new Error(`Kataster-Aufruf ${name} fehlgeschlagen`);
	const first = Array.isArray(result.content) ? result.content[0] : null;
	if (first?.type !== "text")
		throw new Error("Kataster lieferte keine lesbare Antwort");
	return JSON.parse(first.text) as unknown;
}

export function parseKatasterSummary(
	marginRaw: unknown,
	overviewRaw: unknown,
	readinessRaw: unknown,
) {
	const margin = v.parse(marginSchema, marginRaw);
	const overview = v.parse(overviewSchema, overviewRaw);
	const readiness = v.parse(readinessSchema, readinessRaw);
	return {
		period: margin.period,
		currency: "EUR" as const,
		totalCostMinor: margin.totalCostCents,
		totalChargeMinor: margin.totalChargeCents,
		totalMarginMinor: margin.totalMarginCents,
		unallocatedCostMinor: margin.unallocatedCostCents,
		customers: margin.rows,
		openIncidents: overview.openIncidents,
		resources: overview.resources,
		workerAlive: overview.workerAlive,
		assetStatus: overview.assetStatus,
		billingReady: readiness.ready,
		readinessIssues:
			readiness.unassigned.length +
			readiness.unpriced.length +
			readiness.uncoveredPools.length,
	};
}

async function loadSummary(baseUrl: string, token: string) {
	const client = new Client({ name: "fortuna", version: "0.8.0" });
	const transport = new StreamableHTTPClientTransport(
		new URL("/api/mcp", `${baseUrl}/`),
		{ requestInit: { headers: { authorization: `Bearer ${token}` } } },
	);
	try {
		await client.connect(transport);
		const marginRaw = await callJson(client, "margin_summary", {});
		const overviewRaw = await callJson(client, "overview", {});
		const readinessRaw = await callJson(client, "billing_readiness", {});
		return parseKatasterSummary(marginRaw, overviewRaw, readinessRaw);
	} catch (error) {
		if (error instanceof KatasterConnectionError) throw error;
		// The MCP client puts the provider's response body in its message.
		throw new KatasterConnectionError(
			safeProviderMessage(error, "Kataster ist nicht erreichbar"),
		);
	} finally {
		await client.close().catch(() => undefined);
	}
}

async function findConnection(userId: string) {
	return db.query.externalConnections.findFirst({
		where: and(
			eq(externalConnections.userId, userId),
			eq(externalConnections.provider, PROVIDER),
		),
	});
}

export async function getKatasterStatus(userId: string) {
	const row = await findConnection(userId);
	return {
		configured: Boolean(row?.encryptedSecret && row.status !== "disconnected"),
		baseUrl: row?.clientId ?? DEFAULT_KATASTER_URL,
		status: row?.status ?? "disconnected",
		lastSyncAt: row?.lastSyncAt ?? null,
		lastError: row?.lastError ?? null,
	};
}

export async function getKatasterSummary(userId: string) {
	const row = await findConnection(userId);
	if (!row?.encryptedSecret || row.status === "disconnected") {
		return { configured: false as const };
	}
	const baseUrl = normalizeBaseUrl(row.clientId ?? DEFAULT_KATASTER_URL);
	const secret = JSON.parse(
		decryptSecret(row.encryptedSecret),
	) as KatasterSecret;
	try {
		const summary = await loadSummary(baseUrl, secret.token);
		await db
			.update(externalConnections)
			.set({ status: "active", lastSyncAt: new Date(), lastError: null })
			.where(eq(externalConnections.id, row.id));
		return { configured: true as const, baseUrl, ...summary };
	} catch (error) {
		const message =
			error instanceof KatasterConnectionError
				? error.message
				: safeProviderMessage(error, "Kataster ist nicht erreichbar");
		await db
			.update(externalConnections)
			.set({ status: "error", lastError: message.slice(0, 200) })
			.where(eq(externalConnections.id, row.id));
		logger.warn("Kataster read failed", {
			event: "kataster.read_failed",
			errorClass: providerErrorClass(error),
			providerStatus: providerHttpStatus(error),
		});
		throw new KatasterConnectionError(message);
	}
}

export async function storeKatasterConnection(
	userId: string,
	input: { baseUrl: string; token: string },
) {
	const baseUrl = normalizeBaseUrl(input.baseUrl || DEFAULT_KATASTER_URL);
	const token = input.token.trim();
	if (token.length < 24)
		throw new KatasterConnectionError("Das Kataster-Token ist zu kurz");
	const summary = await loadSummary(baseUrl, token);
	await db
		.insert(externalConnections)
		.values({
			userId,
			provider: PROVIDER,
			providerConnectionId: new URL("/api/mcp", `${baseUrl}/`).toString(),
			clientId: baseUrl,
			status: "active",
			encryptedSecret: encryptSecret(
				JSON.stringify({ token } satisfies KatasterSecret),
			),
			lastSyncAt: new Date(),
			lastError: null,
		})
		.onConflictDoUpdate({
			target: [externalConnections.userId, externalConnections.provider],
			set: {
				providerConnectionId: new URL("/api/mcp", `${baseUrl}/`).toString(),
				clientId: baseUrl,
				status: "active",
				encryptedSecret: encryptSecret(
					JSON.stringify({ token } satisfies KatasterSecret),
				),
				lastSyncAt: new Date(),
				lastError: null,
			},
		});
	return { configured: true, baseUrl, period: summary.period };
}

export async function disconnectKataster(userId: string) {
	await db
		.update(externalConnections)
		.set({ status: "disconnected", encryptedSecret: null, lastError: null })
		.where(
			and(
				eq(externalConnections.userId, userId),
				eq(externalConnections.provider, PROVIDER),
			),
		);
}
