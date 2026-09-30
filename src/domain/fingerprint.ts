import { createHash } from "node:crypto";
import { normalizeDescription } from "./normalize";

// Kept apart from normalize.ts: this is the only place in src/domain that needs
// node:crypto, and pulling it into a module a page imports breaks that page in
// the browser.

export type FingerprintInput = {
	bookingDate: string;
	amountMinor: number;
	currency: string;
	description: string;
	counterpartyIban?: string | null;
};

/**
 * Deterministic content fingerprint for a transaction. Two rows with the same
 * account, date, amount, currency and normalised description are the same
 * transaction for import purposes; the DB enforces uniqueness per account.
 */
export function transactionFingerprint(input: FingerprintInput): string {
	const parts = [
		input.bookingDate,
		String(input.amountMinor),
		input.currency.toUpperCase(),
		normalizeDescription(input.description),
		(input.counterpartyIban ?? "").replace(/\s/g, "").toUpperCase(),
	];
	return createHash("sha256")
		.update(parts.join("|"))
		.digest("hex")
		.slice(0, 32);
}
