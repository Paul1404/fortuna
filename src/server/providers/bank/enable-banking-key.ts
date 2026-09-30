import {
	createHash,
	createPrivateKey,
	createPublicKey,
	type KeyObject,
} from "node:crypto";

const MAX_PRIVATE_KEY_BYTES = 32 * 1024;

export type ValidatedPrivateKey = {
	pem: string;
	fingerprint: string;
	modulusLength: number;
};

export class EnableBankingCredentialError extends Error {}

export function validateEnableBankingPrivateKey(
	input: string,
): ValidatedPrivateKey {
	const pem = input.trim();
	if (!pem || Buffer.byteLength(pem, "utf8") > MAX_PRIVATE_KEY_BYTES) {
		throw new EnableBankingCredentialError(
			"Die PEM-Datei ist leer oder größer als 32 KB",
		);
	}

	let key: KeyObject;
	try {
		key = createPrivateKey(pem);
	} catch {
		throw new EnableBankingCredentialError(
			"Die Datei enthält keinen lesbaren privaten PEM-Schlüssel",
		);
	}
	if (key.asymmetricKeyType !== "rsa") {
		throw new EnableBankingCredentialError(
			"Enable Banking benötigt einen privaten RSA-Schlüssel",
		);
	}
	const modulusLength = key.asymmetricKeyDetails?.modulusLength ?? 0;
	if (modulusLength < 2048) {
		throw new EnableBankingCredentialError(
			"Der RSA-Schlüssel muss mindestens 2048 Bit lang sein",
		);
	}

	const normalized = key.export({ format: "pem", type: "pkcs8" }).toString();
	const publicDer = createPublicKey(key).export({
		format: "der",
		type: "spki",
	});
	return {
		pem: normalized,
		fingerprint: createHash("sha256").update(publicDer).digest("hex"),
		modulusLength,
	};
}
