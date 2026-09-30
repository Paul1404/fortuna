import { and, eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { db } from "@/server/db";
import { providerCredentials } from "@/server/db/schema";
import {
	EnableBankingCredentialError,
	validateEnableBankingPrivateKey,
} from "@/server/providers/bank/enable-banking-key";

const ENABLE_BANKING = "enable-banking";
const APPLICATION_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProviderCredentialStatus = {
	configured: boolean;
	applicationId: string | null;
	keyFingerprint: string | null;
	updatedAt: Date | null;
};

export type EnableBankingCredential = {
	applicationId: string;
	privateKeyPem: string;
};

export async function getEnableBankingCredentialStatus(
	userId: string,
): Promise<ProviderCredentialStatus> {
	const row = await db.query.providerCredentials.findFirst({
		where: and(
			eq(providerCredentials.userId, userId),
			eq(providerCredentials.provider, ENABLE_BANKING),
		),
	});
	return row
		? {
				configured: true,
				applicationId: row.applicationId,
				keyFingerprint: row.keyFingerprint,
				updatedAt: row.updatedAt,
			}
		: {
				configured: false,
				applicationId: null,
				keyFingerprint: null,
				updatedAt: null,
			};
}

export async function storeEnableBankingCredential(
	userId: string,
	input: { applicationId: string; privateKeyPem: string },
): Promise<ProviderCredentialStatus> {
	const applicationId = input.applicationId.trim();
	if (!APPLICATION_ID.test(applicationId)) {
		throw new EnableBankingCredentialError(
			"Die Enable-Banking-Anwendungs-ID ist keine gültige UUID",
		);
	}
	const key = validateEnableBankingPrivateKey(input.privateKeyPem);
	const encryptedPrivateKey = encryptSecret(key.pem);
	await db
		.insert(providerCredentials)
		.values({
			userId,
			provider: ENABLE_BANKING,
			applicationId,
			encryptedPrivateKey,
			keyFingerprint: key.fingerprint,
		})
		.onConflictDoUpdate({
			target: [providerCredentials.userId, providerCredentials.provider],
			set: {
				applicationId,
				encryptedPrivateKey,
				keyFingerprint: key.fingerprint,
				updatedAt: new Date(),
			},
		});
	return getEnableBankingCredentialStatus(userId);
}

export async function deleteEnableBankingCredential(
	userId: string,
): Promise<void> {
	await db
		.delete(providerCredentials)
		.where(
			and(
				eq(providerCredentials.userId, userId),
				eq(providerCredentials.provider, ENABLE_BANKING),
			),
		);
}

export async function loadEnableBankingCredential(
	userId: string,
): Promise<EnableBankingCredential | null> {
	const row = await db.query.providerCredentials.findFirst({
		where: and(
			eq(providerCredentials.userId, userId),
			eq(providerCredentials.provider, ENABLE_BANKING),
		),
	});
	if (!row) return null;
	return {
		applicationId: row.applicationId,
		privateKeyPem: decryptSecret(row.encryptedPrivateKey),
	};
}
