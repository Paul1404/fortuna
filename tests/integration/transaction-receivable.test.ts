import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { db, pool } from "@/server/db";
import { user } from "@/server/db/auth-schema";
import { createAccount } from "@/server/services/accounts";
import {
	createReceivableFromTransaction,
	getReceivable,
} from "@/server/services/receivables";
import {
	getTransaction,
	insertTransactions,
	textAlteredBehindFingerprint,
} from "@/server/services/transactions";

const userId = `it-${randomUUID()}`;
beforeAll(async () => {
	await db
		.insert(user)
		.values({ id: userId, name: "Test", email: `${userId}@example.invalid` });
});
afterAll(async () => {
	await db.delete(user).where(eq(user.id, userId));
	await pool.end();
});

it("creates one dated receivable from a partial outflow even on concurrent clicks", async () => {
	const account = await createAccount(userId, {
		name: "Test",
		currency: "EUR",
		type: "current",
		openingBalanceMinor: 10000,
	});
	const input = {
		bookingDate: "2026-10-12",
		amountMinor: -10779,
		currency: "EUR",
		description: "Auslage",
		externalId: "test",
		bankDetails: { note: "Hinweis" },
		notes: "Eigene Notiz",
	};
	const { inserted } = await insertTransactions(userId, account.id, [input], {
		importSource: "test",
	});
	const request = {
		transactionId: inserted[0],
		name: "Auslage",
		debtorName: "Testperson",
		amountMinor: 5000,
	};
	const [first, second] = await Promise.all([
		createReceivableFromTransaction(userId, request),
		createReceivableFromTransaction(userId, request),
	]);
	expect(first.id).toBe(second.id);
	const receivable = await getReceivable(userId, first.id);
	expect(receivable.currency).toBe("EUR");
	expect(receivable.balances).toMatchObject([
		{ date: input.bookingDate, balanceMinor: 5000 },
	]);
	await insertTransactions(
		userId,
		account.id,
		[{ ...input, bankDetails: { reference: "RF123" } }],
		{ importSource: "test" },
	);
	const booking = await getTransaction(userId, inserted[0]);
	expect(booking).toMatchObject({
		amountMinor: -10779,
		notes: "Eigene Notiz",
		receivableId: first.id,
		bankDetails: { note: "Hinweis", reference: "RF123" },
	});
	await expect(
		createReceivableFromTransaction("another-user", request),
	).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("refuses pending, inflow, zero and excessive amounts", async () => {
	const account = await createAccount(userId, {
		name: "Validation",
		currency: "EUR",
		type: "current",
		openingBalanceMinor: 0,
	});
	for (const [index, booking] of [
		{ amountMinor: -100, status: "pending" as const },
		{ amountMinor: 100, status: "booked" as const },
		{ amountMinor: -100, status: "booked" as const },
	].entries()) {
		const { inserted } = await insertTransactions(
			userId,
			account.id,
			[{ ...booking, bookingDate: "2026-10-14", description: `Test ${index}` }],
			{ importSource: "test" },
		);
		const request = {
			transactionId: inserted[0],
			name: "Test",
			debtorName: "Test",
			amountMinor: 101,
		};
		await expect(
			createReceivableFromTransaction(userId, request),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			createReceivableFromTransaction(userId, { ...request, amountMinor: 0 }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	}
});

it("refreshes a placeholder from bank details without leaving a stale fingerprint", async () => {
	const account = await createAccount(userId, {
		name: "Detail refresh",
		currency: "EUR",
		type: "current",
	});
	const original = {
		bookingDate: "2026-10-14",
		amountMinor: -1000,
		description: "Ohne Verwendungszweck",
		externalId: "refresh-test",
	};
	const { inserted } = await insertTransactions(
		userId,
		account.id,
		[original],
		{ importSource: "provider:enable-banking" },
	);
	await insertTransactions(
		userId,
		account.id,
		[
			{
				...original,
				description: "Buchhandlung",
				bankDetails: { note: "Kartenzahlung Buchhandlung" },
			},
		],
		{ importSource: "provider:enable-banking" },
	);
	const booking = await getTransaction(userId, inserted[0]);
	expect(booking.description).toBe("Buchhandlung");
	expect(textAlteredBehindFingerprint(booking)).toBe(false);
});
