import { randomUUID } from "node:crypto";
import { and, eq, gt, or, sql } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { type DbOrTx, db } from "@/server/db";
import { externalConnections, scalableDeviceLogins } from "@/server/db/schema";
import type { DevicePrompt } from "@/server/providers/investment/scalable-hosted-cli";

export type ScalableLoginProvider =
	| "scalable_hosted_cli"
	| "scalable_trading_cli";
export type ScalableLoginClaim = {
	userId: string;
	provider: ScalableLoginProvider;
	generation: number;
	workerId: string;
};

const LOGIN_START_LEASE_MS = 30_000;
const LOGIN_PROMPT_LEASE_GRACE_MS = 60_000;

export function scalableLoginSlot(
	userId: string,
	provider: ScalableLoginProvider,
): string {
	return `${userId}:${provider}`;
}

export async function claimScalableDeviceLogin(
	userId: string,
	provider: ScalableLoginProvider,
): Promise<
	| { kind: "claimed"; claim: ScalableLoginClaim }
	| { kind: "existing_prompt"; prompt: DevicePrompt }
	| { kind: "starting"; generation: number }
> {
	const now = new Date();
	const workerId = randomUUID();
	return db.transaction(async (tx) => {
		await tx
			.insert(scalableDeviceLogins)
			.values({
				userId,
				provider,
				generation: 0,
				status: "expired",
			})
			.onConflictDoNothing({
				target: [scalableDeviceLogins.userId, scalableDeviceLogins.provider],
			});
		const [row] = await tx
			.select()
			.from(scalableDeviceLogins)
			.where(
				and(
					eq(scalableDeviceLogins.userId, userId),
					eq(scalableDeviceLogins.provider, provider),
				),
			)
			.for("update");
		if (!row) throw new Error("Scalable login state could not be created");
		const leaseActive = Boolean(row.leaseExpiresAt && row.leaseExpiresAt > now);
		const promptActive = Boolean(
			row.promptExpiresAt && row.promptExpiresAt > now,
		);
		if (leaseActive && row.status === "starting")
			return { kind: "starting", generation: row.generation };
		if (leaseActive && row.status === "pending" && promptActive) {
			if (!row.encryptedPrompt)
				return { kind: "starting", generation: row.generation };
			return {
				kind: "existing_prompt",
				prompt: JSON.parse(decryptSecret(row.encryptedPrompt)) as DevicePrompt,
			};
		}

		const generation = row.generation + 1;
		const leaseExpiresAt = new Date(Date.now() + LOGIN_START_LEASE_MS);
		await tx
			.update(scalableDeviceLogins)
			.set({
				generation,
				status: "starting",
				workerId,
				leaseExpiresAt,
				encryptedPrompt: null,
				promptExpiresAt: null,
				errorCode: null,
				updatedAt: now,
			})
			.where(eq(scalableDeviceLogins.id, row.id));
		const connectionStatus = {
			status: "disconnected" as const,
			lastError: null,
			updatedAt: now,
			...(provider === "scalable_hosted_cli"
				? {
						scalableReadGeneration: sql`${externalConnections.scalableReadGeneration} + 1`,
					}
				: {}),
		};
		await tx
			.insert(externalConnections)
			.values({
				userId,
				provider,
				...connectionStatus,
				scalableReadGeneration:
					provider === "scalable_hosted_cli" ? 1 : undefined,
			})
			.onConflictDoUpdate({
				target: [externalConnections.userId, externalConnections.provider],
				// `disconnected` blocks legacy callbacks guarded by pending/active/error
				// until this generation completes and saves its own session.
				set: connectionStatus,
			});
		return {
			kind: "claimed",
			claim: { userId, provider, generation, workerId },
		};
	});
}

export async function waitForScalableDevicePrompt(
	userId: string,
	provider: ScalableLoginProvider,
	generation: number,
): Promise<DevicePrompt> {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		const [row] = await db
			.select()
			.from(scalableDeviceLogins)
			.where(
				and(
					eq(scalableDeviceLogins.userId, userId),
					eq(scalableDeviceLogins.provider, provider),
				),
			);
		if (!row || row.generation !== generation)
			throw new Error("Scalable-Anmeldung wurde abgebrochen");
		if (row.status === "pending" && row.encryptedPrompt)
			return JSON.parse(decryptSecret(row.encryptedPrompt)) as DevicePrompt;
		if (row.status !== "starting")
			throw new Error("Scalable-Anmeldung ist nicht mehr aktiv");
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error("Scalable-Anmeldung läuft bereits");
}

export async function persistScalableDevicePrompt(
	claim: ScalableLoginClaim,
	prompt: DevicePrompt,
): Promise<boolean> {
	const rows = await db
		.update(scalableDeviceLogins)
		.set({
			status: "pending",
			encryptedPrompt: encryptSecret(JSON.stringify(prompt)),
			leaseExpiresAt: new Date(prompt.expiresAt + LOGIN_PROMPT_LEASE_GRACE_MS),
			promptExpiresAt: new Date(prompt.expiresAt),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(scalableDeviceLogins.userId, claim.userId),
				eq(scalableDeviceLogins.provider, claim.provider),
				eq(scalableDeviceLogins.generation, claim.generation),
				eq(scalableDeviceLogins.workerId, claim.workerId),
				eq(scalableDeviceLogins.status, "starting"),
				gt(scalableDeviceLogins.leaseExpiresAt, new Date()),
			),
		)
		.returning({ id: scalableDeviceLogins.id });
	return rows.length > 0;
}

export async function scalableDeviceLoginIsCurrent(
	claim: ScalableLoginClaim,
): Promise<boolean> {
	const now = new Date();
	const [row] = await db
		.select({
			status: scalableDeviceLogins.status,
			promptExpiresAt: scalableDeviceLogins.promptExpiresAt,
		})
		.from(scalableDeviceLogins)
		.where(
			and(
				eq(scalableDeviceLogins.userId, claim.userId),
				eq(scalableDeviceLogins.provider, claim.provider),
				eq(scalableDeviceLogins.generation, claim.generation),
				eq(scalableDeviceLogins.workerId, claim.workerId),
				or(
					eq(scalableDeviceLogins.status, "starting"),
					eq(scalableDeviceLogins.status, "pending"),
				),
				gt(scalableDeviceLogins.leaseExpiresAt, now),
			),
		);
	if (!row) return false;
	return (
		row.status !== "pending" ||
		Boolean(row.promptExpiresAt && row.promptExpiresAt > now)
	);
}

export async function completeScalableDeviceLogin(
	claim: ScalableLoginClaim,
	saveConnection: (tx: DbOrTx) => Promise<void>,
): Promise<boolean> {
	return db.transaction(async (tx) => {
		const completed = await tx
			.update(scalableDeviceLogins)
			.set({
				status: "completed",
				workerId: null,
				leaseExpiresAt: null,
				encryptedPrompt: null,
				promptExpiresAt: null,
				errorCode: null,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(scalableDeviceLogins.userId, claim.userId),
					eq(scalableDeviceLogins.provider, claim.provider),
					eq(scalableDeviceLogins.generation, claim.generation),
					eq(scalableDeviceLogins.workerId, claim.workerId),
					eq(scalableDeviceLogins.status, "pending"),
					gt(scalableDeviceLogins.leaseExpiresAt, new Date()),
				),
			)
			.returning({ id: scalableDeviceLogins.id });
		if (!completed.length) return false;
		await saveConnection(tx);
		return true;
	});
}

export async function failScalableDeviceLogin(
	claim: ScalableLoginClaim,
	errorCode: string,
	lastError: string,
): Promise<void> {
	await db.transaction(async (tx) => {
		const failed = await tx
			.update(scalableDeviceLogins)
			.set({
				status: "failed",
				workerId: null,
				leaseExpiresAt: null,
				encryptedPrompt: null,
				promptExpiresAt: null,
				errorCode,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(scalableDeviceLogins.userId, claim.userId),
					eq(scalableDeviceLogins.provider, claim.provider),
					eq(scalableDeviceLogins.generation, claim.generation),
					eq(scalableDeviceLogins.workerId, claim.workerId),
					or(
						eq(scalableDeviceLogins.status, "starting"),
						eq(scalableDeviceLogins.status, "pending"),
					),
				),
			)
			.returning({ id: scalableDeviceLogins.id });
		if (!failed.length) return;
		await tx
			.update(externalConnections)
			.set({ status: "error", lastError, updatedAt: new Date() })
			.where(
				and(
					eq(externalConnections.userId, claim.userId),
					eq(externalConnections.provider, claim.provider),
				),
			);
	});
}

export async function cancelScalableDeviceLoginInDb(
	userId: string,
	provider: ScalableLoginProvider,
): Promise<string | null> {
	return db.transaction(async (tx) => {
		await tx
			.insert(scalableDeviceLogins)
			.values({ userId, provider, generation: 0, status: "expired" })
			.onConflictDoNothing({
				target: [scalableDeviceLogins.userId, scalableDeviceLogins.provider],
			});
		const [login] = await tx
			.select()
			.from(scalableDeviceLogins)
			.where(
				and(
					eq(scalableDeviceLogins.userId, userId),
					eq(scalableDeviceLogins.provider, provider),
				),
			)
			.for("update");
		if (login) {
			await tx
				.update(scalableDeviceLogins)
				.set({
					generation: login.generation + 1,
					status: "cancelled",
					workerId: null,
					leaseExpiresAt: null,
					encryptedPrompt: null,
					promptExpiresAt: null,
					errorCode: null,
					updatedAt: new Date(),
				})
				.where(eq(scalableDeviceLogins.id, login.id));
		}
		const [existingConnection] = await tx
			.select({ encryptedSecret: externalConnections.encryptedSecret })
			.from(externalConnections)
			.where(
				and(
					eq(externalConnections.userId, userId),
					eq(externalConnections.provider, provider),
				),
			);
		const disconnected = {
			status: "disconnected" as const,
			encryptedSecret: null,
			lastError: null,
			updatedAt: new Date(),
			...(provider === "scalable_hosted_cli"
				? {
						scalableReadGeneration: sql`${externalConnections.scalableReadGeneration} + 1`,
					}
				: {}),
		};
		await tx
			.update(externalConnections)
			.set(disconnected)
			.where(
				and(
					eq(externalConnections.userId, userId),
					eq(externalConnections.provider, provider),
				),
			);
		return existingConnection?.encryptedSecret ?? null;
	});
}

export async function getScalableDeviceLoginStatus(
	userId: string,
	provider: ScalableLoginProvider,
): Promise<{ pending: boolean; prompt: DevicePrompt | null }> {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select()
			.from(scalableDeviceLogins)
			.where(
				and(
					eq(scalableDeviceLogins.userId, userId),
					eq(scalableDeviceLogins.provider, provider),
				),
			)
			.for("update");
		if (!row) return { pending: false, prompt: null };
		const now = new Date();
		const leaseActive = Boolean(row.leaseExpiresAt && row.leaseExpiresAt > now);
		const promptActive = Boolean(
			row.promptExpiresAt && row.promptExpiresAt > now,
		);
		if (
			(row.status === "starting" || row.status === "pending") &&
			(!leaseActive || (row.status === "pending" && !promptActive))
		) {
			const expired = await tx
				.update(scalableDeviceLogins)
				.set({
					generation: row.generation + 1,
					status: "expired",
					workerId: null,
					leaseExpiresAt: null,
					encryptedPrompt: null,
					promptExpiresAt: null,
					errorCode: "LOGIN_EXPIRED",
					updatedAt: now,
				})
				.where(
					and(
						eq(scalableDeviceLogins.id, row.id),
						eq(scalableDeviceLogins.generation, row.generation),
					),
				)
				.returning({ id: scalableDeviceLogins.id });
			if (expired.length)
				await tx
					.update(externalConnections)
					.set({
						status: "error",
						lastError: "Scalable-Anmeldung ist abgelaufen.",
						updatedAt: now,
					})
					.where(
						and(
							eq(externalConnections.userId, userId),
							eq(externalConnections.provider, provider),
							eq(externalConnections.status, "pending"),
						),
					);
			return { pending: false, prompt: null };
		}
		return {
			pending:
				leaseActive && (row.status === "starting" || row.status === "pending"),
			prompt:
				row.status === "pending" && row.encryptedPrompt && promptActive
					? (JSON.parse(decryptSecret(row.encryptedPrompt)) as DevicePrompt)
					: null,
		};
	});
}
