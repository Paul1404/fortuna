import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, todayIso } from "@/domain/dates";
import { db, pool } from "@/server/db";
import { user } from "@/server/db/auth-schema";
import { categorisationConsultSessions } from "@/server/db/schema";

// Hr. Körner's answer is scripted; everything else runs against PostgreSQL.
const turn = vi.hoisted(() => ({
	text: "",
	lastInput: null as null | { threadId?: string | null; prompt: string },
	barrier: null as null | (() => Promise<void>),
}));
vi.mock("@/server/services/copilot", () => ({
	isolatedTurn: async (
		_userId: string,
		input: { threadId?: string | null; prompt: string },
	) => {
		turn.lastInput = input;
		if (turn.barrier) await turn.barrier();
		return { threadId: "thread-1", text: turn.text };
	},
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

	it("persists consultation sessions and enforces owner and expiry", async () => {
		turn.text = JSON.stringify({
			nachricht: "Weiter",
			zuordnungen: [],
			rueckfragen: [],
		});
		const first = await consultCategorisation(userId, {});
		const saved = await db.query.categorisationConsultSessions.findFirst({
			where: eq(categorisationConsultSessions.id, first.sessionId),
		});
		expect(saved?.threadId).toBe("thread-1");
		expect(saved?.encryptedHistory).not.toContain("Versandhaus Ost");
		expect(
			(
				await consultCategorisation(userId, {
					sessionId: first.sessionId,
					answer: "Ja",
				})
			).sessionId,
		).toBe(first.sessionId);
		expect(turn.lastInput?.threadId).toBeNull();
		expect(turn.lastInput?.prompt).toContain("Bisheriger Gesprächsverlauf");
		expect(turn.lastInput?.prompt).toContain("Versandhaus Ost");
		await expect(
			consultCategorisation("another-user", { sessionId: first.sessionId }),
		).rejects.toThrow();
		await db
			.update(categorisationConsultSessions)
			.set({ expiresAt: new Date(0) })
			.where(eq(categorisationConsultSessions.id, first.sessionId));
		await expect(
			consultCategorisation(userId, { sessionId: first.sessionId }),
		).rejects.toThrow();
	});

	it("rejects a concurrent update based on stale conversation history", async () => {
		turn.text = JSON.stringify({
			nachricht: "Weiter",
			zuordnungen: [],
			rueckfragen: [],
		});
		const first = await consultCategorisation(userId, {});
		let arrived = 0;
		let release: () => void = () => {};
		const bothArrived = new Promise<void>((resolve) => {
			release = resolve;
		});
		turn.barrier = async () => {
			if (++arrived === 2) release();
			await bothArrived;
		};
		try {
			const results = await Promise.allSettled([
				consultCategorisation(userId, {
					sessionId: first.sessionId,
					answer: "Ja",
				}),
				consultCategorisation(userId, {
					sessionId: first.sessionId,
					answer: "Nein",
				}),
			]);
			expect(
				results.filter((result) => result.status === "fulfilled"),
			).toHaveLength(1);
			expect(
				results.filter((result) => result.status === "rejected"),
			).toHaveLength(1);
		} finally {
			turn.barrier = null;
		}
	});
});
