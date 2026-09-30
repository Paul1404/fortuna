import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, addMonths, startOfMonth, todayIso } from "@/domain/dates";
import { db, pool } from "@/server/db";
import { user } from "@/server/db/auth-schema";
import {
	investmentSourceAccounts,
	investmentSourceTransactions,
} from "@/server/db/schema";
import { createAccount } from "@/server/services/accounts";
import { addValuation, createAsset } from "@/server/services/assets";
import { createCategory } from "@/server/services/categories";
import { netWorthProgress } from "@/server/services/progress";
import { insertTransactions } from "@/server/services/transactions";

const d =
	process.env.FORTUNA_INTEGRATION_TEST === "1" ? describe : describe.skip;

d("net-worth progress against PostgreSQL", () => {
	const userId = `it-${randomUUID()}`;
	const today = todayIso();
	const lastMonth = startOfMonth(addMonths(startOfMonth(today), -1));
	const opening = addDays(lastMonth, -10);

	beforeAll(async () => {
		await db.insert(user).values({
			id: userId,
			name: "Progress Test",
			email: `${userId}@example.invalid`,
		});
		const giro = await createAccount(userId, {
			name: "Giro",
			type: "current",
			currency: "EUR",
			openingBalanceMinor: 100_000,
			openingBalanceDate: opening,
		});
		const savings = await createAccount(userId, {
			name: "Tagesgeld",
			type: "savings",
			currency: "EUR",
			openingBalanceMinor: 0,
			openingBalanceDate: opening,
		});
		const transfer = await createCategory(userId, {
			name: "Umbuchung",
			kind: "transfer",
		});
		await insertTransactions(
			userId,
			giro.id,
			[
				{
					bookingDate: lastMonth,
					amountMinor: 300_000,
					currency: "EUR",
					description: "Gehalt",
				},
				{
					bookingDate: addDays(lastMonth, 5),
					amountMinor: -120_000,
					currency: "EUR",
					description: "Miete",
				},
				{
					bookingDate: addDays(lastMonth, 7),
					amountMinor: -50_000,
					currency: "EUR",
					description: "Übertrag Tagesgeld",
					categoryId: transfer.id,
				},
				// Today: money to the depot. A transfer, not spending.
				{
					bookingDate: today,
					amountMinor: -50_000,
					currency: "EUR",
					description: "Übertrag Depot",
					categoryId: transfer.id,
				},
			],
			{ importSource: "test" },
		);
		await insertTransactions(
			userId,
			savings.id,
			[
				{
					bookingDate: addDays(lastMonth, 7),
					amountMinor: 50_000,
					currency: "EUR",
					description: "Übertrag vom Giro",
					categoryId: transfer.id,
				},
			],
			{ importSource: "test" },
		);
		const car = await createAsset(userId, {
			name: "Auto",
			category: "vehicle",
			currency: "EUR",
			currentValueMinor: 1_000_000,
			valuationDate: opening,
		});
		await addValuation(userId, {
			assetId: car.id,
			date: addDays(lastMonth, 14),
			valueMinor: 1_020_000,
		});
		// A depot whose history begins today with the deposit above; it is
		// now worth 1 000 € including 100 € of cash.
		const [depot] = await db
			.insert(investmentSourceAccounts)
			.values({
				userId,
				provider: "scalable",
				sourceAccountId: `acc-${userId}`,
				method: "cli",
				currency: "EUR",
				cashBalanceMinor: 10_000,
				portfolioValueMinor: 90_000,
				portfolioValuationAt: new Date(),
				cashValuationAt: new Date(),
			})
			.returning();
		await db.insert(investmentSourceTransactions).values({
			userId,
			accountId: depot.id,
			sourceId: "dep-1",
			sourceFingerprint: "dep-1",
			occurredAt: new Date(),
			kind: "deposit",
			status: "SETTLED",
			amountMinor: 50_000,
			currency: "EUR",
			encryptedRawMetadata: "test",
		});
	});

	afterAll(async () => {
		await db.delete(user).where(eq(user.id, userId));
		await pool.end();
	});

	it("splits last month into saving and revaluation, transfers excluded", async () => {
		const progress = await netWorthProgress(userId, "last_month");
		expect(progress.growth).toMatchObject({
			savingMinor: 180_000,
			marketMinor: 20_000,
			otherMinor: 0,
			totalMinor: 200_000,
			// Last month ended before the depot's first activity: it was empty.
			depot: "included",
		});
	});

	it("counts the depot's gain beyond the deposit as market, the deposit as neither", async () => {
		const progress = await netWorthProgress(userId, "month");
		expect(progress.growth).toMatchObject({
			savingMinor: 0,
			// 1 000 € now, 500 € of it paid in this month.
			marketMinor: 50_000,
			otherMinor: 0,
			totalMinor: 50_000,
			depot: "included",
		});
	});

	it("counts the last full month in the streak, never the running one", async () => {
		const progress = await netWorthProgress(userId, "year");
		expect(progress.streak).toEqual({
			months: 1,
			since: lastMonth.slice(0, 7),
			fullMonths: 1,
		});
		const growth = progress.growth;
		expect(growth).not.toBeNull();
		if (growth)
			expect(growth.savingMinor + growth.marketMinor + growth.otherMinor).toBe(
				growth.totalMinor,
			);
	});
});
