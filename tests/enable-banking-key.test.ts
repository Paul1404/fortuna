import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	EnableBankingCredentialError,
	validateEnableBankingPrivateKey,
} from "@/server/providers/bank/enable-banking-key";

describe("Enable Banking private key validation", () => {
	it("normalises a sufficiently strong RSA private key and fingerprints its public key", () => {
		const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
		const result = validateEnableBankingPrivateKey(
			privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
		);
		expect(result.pem).toContain("BEGIN PRIVATE KEY");
		expect(result.modulusLength).toBe(2048);
		expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
	});

	it("rejects public keys and non-RSA private keys", () => {
		const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
		expect(() =>
			validateEnableBankingPrivateKey(
				rsa.publicKey.export({ format: "pem", type: "spki" }).toString(),
			),
		).toThrow(EnableBankingCredentialError);

		const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
		expect(() =>
			validateEnableBankingPrivateKey(
				ec.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
			),
		).toThrow("Enable Banking benötigt einen privaten RSA-Schlüssel");
	});
});
