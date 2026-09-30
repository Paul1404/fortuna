import { describe, expect, it } from "vitest";
import {
	classifyBrokerTransactionRevision,
	classifyInvestmentSyncFailure,
} from "@/domain/investment-source";

const prior = {
	fingerprint: "first",
	status: "PENDING",
	kind: "buy",
	isin: "IE00B4L5Y983",
	currency: "EUR",
};

describe("broker transaction revisions", () => {
	it("keeps repeat reads idempotent", () => {
		expect(classifyBrokerTransactionRevision(prior, prior)).toBe("duplicate");
	});
	it("accepts a same-ID lifecycle or monetary correction for audit", () => {
		expect(
			classifyBrokerTransactionRevision(prior, { ...prior, status: "FILLED" }),
		).toBe("revision");
		expect(
			classifyBrokerTransactionRevision(prior, {
				...prior,
				fingerprint: "corrected",
			}),
		).toBe("revision");
	});
	it("holds an ambiguous reused ID instead of overwriting a different asset", () => {
		expect(
			classifyBrokerTransactionRevision(prior, {
				...prior,
				isin: "US0378331005",
			}),
		).toBe("identity_conflict");
		expect(
			classifyBrokerTransactionRevision(prior, { ...prior, kind: "sell" }),
		).toBe("identity_conflict");
		expect(
			classifyBrokerTransactionRevision(prior, { ...prior, currency: "USD" }),
		).toBe("identity_conflict");
	});
	it("reports only an allowlisted SQL state even when the error contains private text", () => {
		expect(
			classifyInvestmentSyncFailure({
				cause: { code: "23505", message: "private IBAN" },
			}),
		).toBe("DB_CONSTRAINT_CONFLICT");
		expect(
			classifyInvestmentSyncFailure({ code: "UNTRUSTED_PRIVATE_VALUE" }),
		).toBe("SYNC_FAILED");
	});
});
