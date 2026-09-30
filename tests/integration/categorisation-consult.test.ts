import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, todayIso } from "@/domain/dates";
import { db, pool } from "@/server/db";
import { user } from "@/server/db/auth-schema";

// Hr. Körner's answer is scripted; everything else runs against PostgreSQL.
const turn = vi.hoisted(() => ({ text: "" }));
vi.mock("@/server/services/copilot", () => ({
	isolatedTurn: async () => ({ threadId: "thread-1", text: turn.text }),
}));

const { createAccount } = await import("@/server/services/accounts");
const { consultCategorisation } = await import(
	"@/server/services/categorisation"
);
const { insertTransactions } = await import("@/server/services/transactions");

const d =
	process.env.FORTUNA_INTEGRATION_TEST === "1" ? describe : describe.skip;

d("Hr. Körner's categorisation consultation", () => {
	const userId = `it-${randomUUID()}`;
	const ids: string[] = [];
	beforeAll(async () => {
		await db.insert(user).values({
			id: userId,
			name: "Körner Test",
			email: `${userId}@example.invalid`,
		});
		const account = await createAccount(userId, {
			name: "Giro",
			type: "current",
			currency: "EUR",
		});
		const today = todayIso();
		const result = await insertTransactions(
			userId,
			account.id,
			[
				{
					bookingDate: addDays(today, -10),
					amountMinor: -4_999,
					currency: "EUR",
					description: "Bestellung 302-1",
					counterpartyName: "Versandhaus Ost",
				},
				{
					bookingDate: addDays(today, -3),
					amountMinor: 1_299,
					currency: "EUR",
					description: "Erstattung 302-1",
					counterpartyName: "Versandhaus Ost",
				},
			],
			{ importSource: "test" },
		);
		ids.push(...result.inserted);
	});
	afterAll(async () => {
		await db.delete(user).where(eq(user.id, userId));
		await pool.end();
	});

	it("files a merchant's payments and refunds alike when he answers once", async () => {
		turn.text = JSON.stringify({
			nachricht: "Erledigt.",
			zuordnungen: [
				{
					haendler: "Versandhaus Ost",
					kategorie: "Einkauf",
					neu: true,
					begruendung: "Versandhandel",
				},
			],
			rueckfragen: [],
		});
		const result = await consultCategorisation(userId, {});
		expect(ids).toHaveLength(2);
		expect(result.assignments.map((row) => row.transactionId).sort()).toEqual(
			[...ids].sort(),
		);
		expect(result.openMerchants).toBe(0);
	});
});
