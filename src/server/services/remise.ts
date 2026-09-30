import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { and, count, eq, inArray } from "drizzle-orm";
import * as v from "valibot";
import { todayIso } from "@/domain/dates";
import {
	findRemiseAssetMatch,
	isActiveRemiseItem,
	remiseAcquisitionCostMinor,
	remiseValuationNote,
	remiseValueMinor,
} from "@/domain/remise-sync";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { db } from "@/server/db";
import {
	assets,
	type ExternalConnection,
	externalConnections,
} from "@/server/db/schema";
import { logger } from "@/server/logger";
import {
	providerErrorClass,
	providerHttpStatus,
	safeProviderMessage,
} from "@/server/provider-errors";
import { addValuation, createAsset, deleteAsset, updateAsset } from "./assets";

const PROVIDER = "remise";
const REMISE_ORIGIN = "https://app.remise.pdcd.net";
const REMISE_RESOURCE = `${REMISE_ORIGIN}/mcp`;
const REMISE_SCOPE = "remise:read offline_access";

type PendingSecret = {
	kind: "pending";
	codeVerifier: string;
	redirectUri: string;
};

type TokenSecret = {
	kind: "token";
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	scope: string;
};

const remiseSnapshotItemSchema = v.object({
	slug: v.pipe(v.string(), v.regex(/^[a-z0-9-]{1,160}$/u)),
	sku: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
	title: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
	lifecycle: v.picklist([
		"preparing",
		"ready-for-import",
		"imported-draft",
		"ready-to-publish",
		"published",
		"reserved",
		"sold",
		"cancelled",
		"archived",
	]),
	quantity: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100_000)),
	valuation: v.nullable(
		v.pipe(v.number(), v.minValue(0), v.maxValue(100_000_000)),
	),
	valuationBasis: v.picklist(["target-price", "asking-price", "unpriced"]),
	acquisitionCost: v.nullable(
		v.pipe(v.number(), v.minValue(0), v.maxValue(100_000_000)),
	),
	updatedAt: v.string(),
});

const remiseSnapshotSchema = v.object({
	mode: v.literal("fortuna-sync"),
	observedAt: v.pipe(
		v.string(),
		v.check((value) => Number.isFinite(Date.parse(value))),
	),
	currency: v.literal("EUR"),
	items: v.array(remiseSnapshotItemSchema),
});

export type RemiseSnapshot = v.InferOutput<typeof remiseSnapshotSchema>;

function publicBaseUrl(): string {
	const value = process.env.BETTER_AUTH_URL?.replace(/\/$/u, "");
	if (!value) throw new Error("Die öffentliche Fortuna-URL fehlt");
	return value;
}

async function jsonResponse(response: Response, label: string) {
	if (!response.ok) throw new Error(`${label} (${response.status})`);
	return response.json() as Promise<Record<string, unknown>>;
}

function tokenSecret(payload: Record<string, unknown>, previous?: TokenSecret) {
	const accessToken = payload.access_token;
	const refreshToken = payload.refresh_token ?? previous?.refreshToken;
	const expiresIn = Number(payload.expires_in ?? 3600);
	if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
		throw new Error("Remise hat keine verwendbaren OAuth-Tokens geliefert");
	}
	return {
		kind: "token",
		accessToken,
		refreshToken,
		expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
		scope:
			typeof payload.scope === "string"
				? payload.scope
				: (previous?.scope ?? REMISE_SCOPE),
	} satisfies TokenSecret;
}

export async function getRemiseConnectionStatus(userId: string) {
	const row = await db.query.externalConnections.findFirst({
		where: and(
			eq(externalConnections.userId, userId),
			eq(externalConnections.provider, PROVIDER),
		),
	});
	const [assetCount] = await db
		.select({ value: count() })
		.from(assets)
		.where(and(eq(assets.userId, userId), eq(assets.syncSource, PROVIDER)));
	let configured = false;
	if (row?.encryptedSecret) {
		try {
			configured =
				(JSON.parse(decryptSecret(row.encryptedSecret)) as { kind?: unknown })
					.kind === "token";
		} catch {
			configured = false;
		}
	}
	return {
		configured,
		status: row?.status ?? null,
		lastSyncAt: row?.lastSyncAt ?? null,
		lastError: row?.lastError ?? null,
		assetCount: assetCount?.value ?? 0,
	};
}

export async function beginRemiseConnection(
	userId: string,
): Promise<{ redirectUrl: string }> {
	const redirectUri = `${publicBaseUrl()}/api/integrations/remise/callback`;
	const registration = await fetch(
		`${REMISE_ORIGIN}/api/auth/oauth2/register`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				client_name: "Fortuna",
				application_type: "web",
				redirect_uris: [redirectUri],
				token_endpoint_auth_method: "none",
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
				scope: REMISE_SCOPE,
				require_pkce: true,
			}),
			signal: AbortSignal.timeout(15_000),
		},
	);
	const registered = await jsonResponse(
		registration,
		"Remise-Verbindung konnte nicht registriert werden",
	);
	if (typeof registered.client_id !== "string") {
		throw new Error("Remise hat keine Client-ID geliefert");
	}
	const state = randomUUID();
	const codeVerifier = randomBytes(32).toString("base64url");
	const challenge = createHash("sha256")
		.update(codeVerifier)
		.digest("base64url");
	const pending: PendingSecret = { kind: "pending", codeVerifier, redirectUri };
	await db
		.insert(externalConnections)
		.values({
			userId,
			provider: PROVIDER,
			providerConnectionId: state,
			clientId: registered.client_id,
			status: "pending",
			encryptedSecret: encryptSecret(JSON.stringify(pending)),
			lastError: null,
		})
		.onConflictDoUpdate({
			target: [externalConnections.userId, externalConnections.provider],
			set: {
				providerConnectionId: state,
				clientId: registered.client_id,
				status: "pending",
				encryptedSecret: encryptSecret(JSON.stringify(pending)),
				lastError: null,
				updatedAt: new Date(),
			},
		});
	const query = new URLSearchParams({
		client_id: registered.client_id,
		redirect_uri: redirectUri,
		response_type: "code",
		scope: REMISE_SCOPE,
		resource: REMISE_RESOURCE,
		state,
		code_challenge_method: "S256",
		code_challenge: challenge,
	});
	return {
		redirectUrl: `${REMISE_ORIGIN}/api/auth/oauth2/authorize?${query}`,
	};
}

async function pendingConnection(state: string) {
	const connection = await db.query.externalConnections.findFirst({
		where: and(
			eq(externalConnections.provider, PROVIDER),
			eq(externalConnections.providerConnectionId, state),
			eq(externalConnections.status, "pending"),
		),
	});
	if (!connection?.encryptedSecret || !connection.clientId) {
		throw new Error("Die Remise-Verbindung wurde nicht gefunden");
	}
	const secret = JSON.parse(
		decryptSecret(connection.encryptedSecret),
	) as PendingSecret;
	if (secret.kind !== "pending") {
		throw new Error("Die Remise-Freigabe ist nicht mehr gültig");
	}
	return { connection, secret };
}

export async function completeRemiseConnection(state: string, code: string) {
	const { connection, secret } = await pendingConnection(state);
	const response = await fetch(`${REMISE_ORIGIN}/api/auth/oauth2/token`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: connection.clientId as string,
			code,
			redirect_uri: secret.redirectUri,
			code_verifier: secret.codeVerifier,
			resource: REMISE_RESOURCE,
		}),
		signal: AbortSignal.timeout(15_000),
	});
	const tokens = tokenSecret(
		await jsonResponse(
			response,
			"Remise-Freigabe konnte nicht übernommen werden",
		),
	);
	await db
		.update(externalConnections)
		.set({
			providerConnectionId: connection.clientId,
			status: "active",
			encryptedSecret: encryptSecret(JSON.stringify(tokens)),
			lastError: null,
		})
		.where(eq(externalConnections.id, connection.id));
	return syncRemiseConnection(connection.userId);
}

/**
 * The state value travels through the browser, so this only marks a connection
 * that is still waiting for its callback, and stores a fixed message rather
 * than anything the redirect carried.
 */
export async function failRemiseConnection(state: string, message: string) {
	await db
		.update(externalConnections)
		.set({ status: "error", lastError: message.slice(0, 200) })
		.where(
			and(
				eq(externalConnections.provider, PROVIDER),
				eq(externalConnections.providerConnectionId, state),
				inArray(externalConnections.status, ["pending", "error"]),
			),
		);
}

async function refreshToken(
	connection: ExternalConnection,
	current: TokenSecret,
) {
	if (!connection.clientId) throw new Error("Der Remise-Client fehlt");
	const response = await fetch(`${REMISE_ORIGIN}/api/auth/oauth2/token`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			client_id: connection.clientId,
			refresh_token: current.refreshToken,
			resource: REMISE_RESOURCE,
		}),
		signal: AbortSignal.timeout(15_000),
	});
	const next = tokenSecret(
		await jsonResponse(response, "Remise-Zugriff konnte nicht erneuert werden"),
		current,
	);
	await db
		.update(externalConnections)
		.set({ encryptedSecret: encryptSecret(JSON.stringify(next)) })
		.where(eq(externalConnections.id, connection.id));
	return next;
}

async function activeToken(connection: ExternalConnection) {
	if (!connection.encryptedSecret)
		throw new Error("Remise ist nicht verbunden");
	const secret = JSON.parse(
		decryptSecret(connection.encryptedSecret),
	) as TokenSecret;
	if (secret.kind !== "token") throw new Error("Remise ist nicht freigegeben");
	return secret.expiresAt > Date.now() + 60_000
		? secret
		: refreshToken(connection, secret);
}

function parseSnapshot(payload: unknown): RemiseSnapshot {
	try {
		return v.parse(remiseSnapshotSchema, payload);
	} catch {
		throw new Error("Die Remise-Bestandsantwort ist ungültig");
	}
}

async function loadSnapshot(accessToken: string): Promise<RemiseSnapshot> {
	const client = new Client({ name: "fortuna", version: "0.5.0" });
	const transport = new StreamableHTTPClientTransport(
		new URL(REMISE_RESOURCE),
		{
			requestInit: {
				headers: { authorization: `Bearer ${accessToken}` },
			},
		},
	);
	try {
		await client.connect(transport);
		const result = await client.callTool({
			name: "remise_fortuna_sync",
			arguments: {},
		});
		if (result.isError)
			throw new Error("Remise konnte den Bestand nicht lesen");
		const first = Array.isArray(result.content) ? result.content[0] : null;
		if (first?.type !== "text") {
			throw new Error("Remise hat keinen lesbaren Bestand geliefert");
		}
		return parseSnapshot(JSON.parse(first.text));
	} finally {
		await client.close().catch(() => undefined);
	}
}

export async function applySnapshot(userId: string, snapshot: RemiseSnapshot) {
	const existing = await db.query.assets.findMany({
		where: eq(assets.userId, userId),
	});
	const linked = new Map(
		existing
			.filter(
				(asset) => asset.syncSource === PROVIDER && asset.externalId !== null,
			)
			.map((asset) => [asset.externalId as string, asset]),
	);
	const manual = new Map(
		existing
			.filter((asset) => asset.syncSource === null && asset.isActive)
			.map((asset) => [asset.id, asset]),
	);
	const seen = new Set<string>();
	const deleted = new Set<string>();
	let created = 0;
	let updated = 0;
	let deactivated = 0;
	let merged = 0;
	let skipped = 0;
	const date = snapshot.observedAt.slice(0, 10) || todayIso();
	for (const item of snapshot.items) {
		const reference = `remise:${item.slug}`;
		seen.add(item.slug);
		let current = linked.get(item.slug);
		const active = isActiveRemiseItem(item);
		const valueMinor = remiseValueMinor(item);
		if (!active) {
			if (current?.isActive) {
				await updateAsset(userId, {
					id: current.id,
					isActive: false,
					disposedAt: date,
				});
				deactivated += 1;
			}
			continue;
		}
		// Only an item without an asset, or with the placeholder the sync created
		// itself, may be merged into a manual asset. One already linked to an
		// asset the owner curated stays there: matching it again hijacked a
		// newer, similarly named asset and left both counting in net worth.
		const matchId =
			!current || current.reference === reference
				? findRemiseAssetMatch(item, [...manual.values()])
				: null;
		const match = matchId ? manual.get(matchId) : undefined;
		if (match) {
			if (current?.reference === reference) {
				await deleteAsset(userId, current.id);
				deleted.add(current.id);
				merged += 1;
			}
			current = match;
			manual.delete(match.id);
			await updateAsset(userId, {
				id: match.id,
				syncSource: PROVIDER,
				externalId: item.slug,
			});
		}
		if (valueMinor === null) {
			skipped += 1;
			if (current && !current.isActive) {
				await updateAsset(userId, {
					id: current.id,
					isActive: true,
					disposedAt: null,
				});
			}
			continue;
		}
		const note = remiseValuationNote(item);
		if (!current) {
			await createAsset(userId, {
				name: item.title,
				category: "inventory",
				currency: snapshot.currency,
				acquisitionCostMinor: remiseAcquisitionCostMinor(item),
				currentValueMinor: valueMinor,
				valuationDate: date,
				valuationSource: "market",
				reference,
				syncSource: PROVIDER,
				externalId: item.slug,
				section: "Remise",
				notes: note,
			});
			created += 1;
			continue;
		}
		const automaticallyManaged = current.reference === reference;
		await updateAsset(userId, {
			id: current.id,
			isActive: true,
			disposedAt: null,
			syncSource: PROVIDER,
			externalId: item.slug,
			...(automaticallyManaged
				? {
						name: item.title,
						category: "inventory",
						section: "Remise",
						notes: note,
					}
				: {}),
			...(current.acquisitionCostMinor === null
				? { acquisitionCostMinor: remiseAcquisitionCostMinor(item) }
				: {}),
		});
		if (
			current.currentValueMinor !== valueMinor ||
			current.valuationDate !== date
		) {
			await addValuation(userId, {
				assetId: current.id,
				date,
				valueMinor,
				source: "market",
				notes: note,
			});
		}
		updated += 1;
	}
	for (const asset of existing) {
		if (
			asset.syncSource !== PROVIDER ||
			!asset.externalId ||
			seen.has(asset.externalId) ||
			deleted.has(asset.id) ||
			!asset.isActive
		)
			continue;
		await updateAsset(userId, {
			id: asset.id,
			isActive: false,
			disposedAt: date,
		});
		deactivated += 1;
	}
	return {
		total: snapshot.items.length,
		created,
		updated,
		deactivated,
		merged,
		skipped,
	};
}

export async function syncRemiseConnection(userId: string) {
	const connection = await db.query.externalConnections.findFirst({
		where: and(
			eq(externalConnections.userId, userId),
			eq(externalConnections.provider, PROVIDER),
		),
	});
	if (!connection) throw new Error("Remise ist nicht verbunden");
	try {
		const token = await activeToken(connection);
		const result = await applySnapshot(
			userId,
			await loadSnapshot(token.accessToken),
		);
		await db
			.update(externalConnections)
			.set({ status: "active", lastSyncAt: new Date(), lastError: null })
			.where(eq(externalConnections.id, connection.id));
		return result;
	} catch (error) {
		// Never persist the provider's own message; it can hold a response body.
		const message = safeProviderMessage(
			error,
			"Remise-Abgleich fehlgeschlagen",
		);
		await db
			.update(externalConnections)
			.set({ status: "error", lastError: message.slice(0, 200) })
			.where(eq(externalConnections.id, connection.id));
		logger.warn("Remise sync failed", {
			event: "remise.sync_failed",
			errorClass: providerErrorClass(error),
			providerStatus: providerHttpStatus(error),
		});
		throw new Error(message);
	}
}

export async function disconnectRemise(userId: string) {
	await db
		.update(externalConnections)
		.set({
			status: "disconnected",
			encryptedSecret: null,
			lastError: null,
		})
		.where(
			and(
				eq(externalConnections.userId, userId),
				eq(externalConnections.provider, PROVIDER),
			),
		);
}
