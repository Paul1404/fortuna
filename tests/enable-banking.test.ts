import { describe, expect, it } from "vitest";
import {
	TRANSACTION_READ_OVERLAP_DAYS,
	transactionDescription,
	transactionReadFrom,
	transactionStatus,
} from "@/server/services/enable-banking";

describe("booking text", () => {
	it("refuses an ISO code as the purpose", () => {
		// The Sparda answers PMNT — "payment" — which made four bookings, one of
		// them 5.000 €, unfilable by owner and model alike.
		expect(
			transactionDescription({
				bank_transaction_code: { description: "PMNT" },
				creditor: { name: "Stadtwerke" },
			}),
		).toBe("Stadtwerke");
	});

	it("prefers the purpose, then the counterparty", () => {
		expect(
			transactionDescription({
				remittance_information: ["Rechnung 4711"],
				creditor: { name: "Stadtwerke" },
			}),
		).toBe("Rechnung 4711");
		expect(transactionDescription({ debtor: { name: "Oma" } })).toBe("Oma");
	});

	it("says so rather than showing a code when nothing is left", () => {
		expect(
			transactionDescription({
				bank_transaction_code: { description: "PMNT" },
			}),
		).toBe("Ohne Verwendungszweck");
		expect(transactionDescription({})).toBe("Ohne Verwendungszweck");
	});

	it("keeps a description that is actually readable", () => {
		expect(
			transactionDescription({
				bank_transaction_code: { description: "SEPA-Überweisung" },
			}),
		).toBe("SEPA-Überweisung");
	});
});

describe("transaction status", () => {
	it("books BOOK and keeps held or scheduled payments pending", () => {
		expect(transactionStatus("BOOK")).toBe("booked");
		expect(transactionStatus("PDNG")).toBe("pending");
		expect(transactionStatus("HOLD")).toBe("pending");
		expect(transactionStatus("SCHD")).toBe("pending");
		expect(transactionStatus(undefined)).toBe("pending");
	});

	it("drops cancelled and rejected payments instead of forecasting them", () => {
		// Mapped to pending, a rejected transfer stayed in the forecast as money
		// about to leave the account.
		expect(transactionStatus("CNCL")).toBeNull();
		expect(transactionStatus("RJCT")).toBeNull();
	});
});

describe("transaction read window", () => {
	it("reads the whole history the bank offers on a first sync", () => {
		expect(transactionReadFrom(null)).toBeNull();
	});

	it("overlaps the newest stored booking instead of starting on it", () => {
		// A booking dated the 18th that only appears after one dated the 20th
		// was synced lay before `date_from` and was never read.
		expect(TRANSACTION_READ_OVERLAP_DAYS).toBe(7);
		expect(transactionReadFrom("2026-09-20")).toBe("2026-09-13");
		expect(transactionReadFrom("2026-03-03")).toBe("2026-02-24");
	});
});
