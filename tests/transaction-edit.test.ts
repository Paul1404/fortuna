import { describe, expect, it } from "vitest";
import { importSourceLabel } from "@/lib/labels";
import {
	type EditableTransaction,
	transactionEditPatch,
} from "@/lib/transaction-edit";

const booking: EditableTransaction = {
	id: "tx-1",
	categoryId: "cat-groceries",
	merchantName: "REWE",
	notes: null,
	status: "booked",
	recurringPaymentId: "rec-1",
	transferGroupId: null,
};

const unchanged = {
	categoryId: "cat-groceries",
	merchantName: "REWE",
	notes: null,
	status: "booked" as const,
	recurringPaymentId: "rec-1",
	createRule: false,
};

describe("transactionEditPatch", () => {
	it("sends nothing but the id when nothing changed", () => {
		expect(transactionEditPatch(booking, unchanged)).toEqual({ id: "tx-1" });
	});

	it("leaves a rule's category alone when only the note changes", () => {
		// Sending the category would mark it manual on the server.
		expect(
			transactionEditPatch(booking, { ...unchanged, notes: "Wocheneinkauf" }),
		).toEqual({ id: "tx-1", notes: "Wocheneinkauf" });
	});

	it("sends a changed or cleared category", () => {
		expect(
			transactionEditPatch(booking, { ...unchanged, categoryId: "cat-other" }),
		).toEqual({ id: "tx-1", categoryId: "cat-other" });
		expect(
			transactionEditPatch(booking, { ...unchanged, categoryId: null }),
		).toEqual({ id: "tx-1", categoryId: null });
	});

	it("sends the current category with a rule request", () => {
		expect(
			transactionEditPatch(booking, { ...unchanged, createRule: true }),
		).toEqual({ id: "tx-1", categoryId: "cat-groceries", createRule: true });
	});

	it("never touches the category of a transfer leg", () => {
		// The disabled select is missing from the form data, so it reads null.
		const transfer = {
			...booking,
			categoryId: "cat-transfer",
			transferGroupId: "grp-1",
		};
		expect(
			transactionEditPatch(transfer, {
				...unchanged,
				categoryId: null,
				notes: "Sparrate",
				createRule: true,
			}),
		).toEqual({ id: "tx-1", notes: "Sparrate" });
	});

	it("sends a changed status, merchant and recurring link", () => {
		expect(
			transactionEditPatch(booking, {
				...unchanged,
				status: "pending",
				merchantName: "Rewe Markt",
				recurringPaymentId: null,
			}),
		).toEqual({
			id: "tx-1",
			status: "pending",
			merchantName: "Rewe Markt",
			recurringPaymentId: null,
		});
	});
});

describe("importSourceLabel", () => {
	it("names every source the write paths use", () => {
		expect(importSourceLabel("manual")).toBe("Manuell");
		expect(importSourceLabel("csv")).toBe("CSV");
		expect(importSourceLabel("cash")).toBe("Bargeld");
		expect(importSourceLabel("paypal")).toBe("PayPal");
		expect(importSourceLabel("provider:enable-banking")).toBe("Bankabruf");
	});

	it("falls back to a dash, never the raw source", () => {
		expect(importSourceLabel("something-new")).toBe("—");
	});
});
