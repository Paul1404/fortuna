import {
	createCipheriv,
	createDecipheriv,
	hkdfSync,
	randomBytes,
} from "node:crypto";

// AES-256-GCM for particularly sensitive stored secrets (bank-provider tokens).
// The key is derived from BETTER_AUTH_SECRET with HKDF so no second secret has
// to be provisioned; rotating BETTER_AUTH_SECRET invalidates stored tokens,
// which is acceptable because they can be re-obtained by reconnecting.

const VERSION = "v1";

function key(): Buffer {
	const secret = process.env.BETTER_AUTH_SECRET;
	if (!secret || secret.length < 32) {
		throw new Error("BETTER_AUTH_SECRET is required for secret encryption");
	}
	return Buffer.from(
		hkdfSync("sha256", secret, "fortuna-secrets", VERSION, 32),
	);
}

export function encryptSecret(plaintext: string): string {
	return encryptBytes(Buffer.from(plaintext, "utf8"));
}

export function encryptBytes(plaintext: Buffer): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key(), iv);
	const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [
		VERSION,
		iv.toString("base64url"),
		tag.toString("base64url"),
		encrypted.toString("base64url"),
	].join(".");
}

export function decryptSecret(payload: string): string {
	return decryptBytes(payload).toString("utf8");
}

export function decryptBytes(payload: string): Buffer {
	const [version, ivB64, tagB64, dataB64] = payload.split(".");
	if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
		throw new Error("Unrecognised encrypted secret format");
	}
	const decipher = createDecipheriv(
		"aes-256-gcm",
		key(),
		Buffer.from(ivB64, "base64url"),
	);
	decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
	return Buffer.concat([
		decipher.update(Buffer.from(dataB64, "base64url")),
		decipher.final(),
	]);
}
