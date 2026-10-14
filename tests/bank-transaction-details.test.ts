import { expect, it } from "vitest";
import { bankTransactionDetails } from "@/domain/bank-transaction-details";

it("retains selected useful details without persisting the raw bank response", () => {
	expect(
		bankTransactionDetails({
			remittance_information: [" Rechnung ", 4, "4711"],
			note: "Hinweis",
			reference_number: "RF123",
			creditor_account: { iban: "private" },
			unknown: "private",
		}),
	).toEqual({
		purpose: "Rechnung  · 4711",
		note: "Hinweis",
		reference: "RF123",
	});
	expect(
		bankTransactionDetails({
			note: " ",
			reference_number: {},
			bank_transaction_code: null,
		}),
	).toEqual({});
});
