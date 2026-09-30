import { describe, expect, it } from "vitest";
import { contractCompleteness } from "@/server/services/contracts";

const insurance = {
	provider: "Versicherung AG",
	contractNumber: "V-42",
	costMinor: 2_000,
	frequency: "monthly" as const,
	startDate: "2026-01-01",
	endDate: null,
	renewalDate: "2027-01-01",
	cancellationDate: null,
	accountId: "account",
	recurringPaymentId: null,
	category: "insurance" as const,
};

describe("contract completeness", () => {
	it("requires a policy document for a fully documented insurance", () => {
		expect(contractCompleteness(insurance, []).completeness).toBe(80);
		expect(contractCompleteness(insurance, []).missingFields).toContain(
			"Versicherungsschein",
		);
		expect(
			contractCompleteness(insurance, [{ type: "policy" }]).completeness,
		).toBe(100);
	});
});
