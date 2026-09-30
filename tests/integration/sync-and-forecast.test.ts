import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, addMonths, todayIso } from "@/domain/dates";
import { encryptSecret } from "@/server/crypto";
import { db, pool } from "@/server/db";
import { user } from "@/server/db/auth-schema";
import {
	accounts,
	bankConnections,
	categories,
	transactions,
} from "@/server/db/schema";
import { createAccount } from "@/server/services/accounts";
import { ensureDefaultCategories } from "@/server/services/categories";
import {
	expireUnreportedPending,
	linkPaypalFunding,
} from "@/server/services/enable-banking";
import { cashflowForecast } from "@/server/services/forecast";
import { insertTransactions } from "@/server/services/transactions";

// Runs against a real PostgreSQL (DATABASE_URL). Skipped unless
// FORTUNA_INTEGRATION_TEST=1 so the fast unit suite never needs a database.
const enabled = process.env.FORTUNA_INTEGRATION_TEST === "1";
const d = enabled ? describe : describe.skip;

d("bank sync and forecast against PostgreSQL", () => {
	const userId = `it-${randomUUID()}`;
	const today = todayIso();

	beforeAll(async () => {
		await db.insert(user).values({
			id: userId,
			name: "Integration Sync",
			email: `${userId}@example.invalid`,
		});
		await ensureDefaultCategories(userId);
	});

	afterAll(async () => {
		await db.delete(user).where(eq(user.id, userId));
		await pool.end();
	});

	it("names a currency the forecast could not convert", async () => {
		// XTS is the ISO code reserved for testing; no rate will ever exist.
		await createAccount(userId, {
			name: "Fremdwährung",
			type: "current",
			currency: "XTS",
			openingBalanceMinor: 70_000,
			openingBalanceDate: addMonths(today, -1),
		});
		const report = await cashflowForecast(userId, { horizonDays: 30 });
		expect(report.unconverted).toEqual(["XTS"]);
		// Left out of the figures, not silently counted as zero and complete.
		expect(report.openingBalanceMinor).toBe(0);
	});

	it("lets go of a held booking the bank replaced under a new reference", async () => {
		const account = await createAccount(userId, {
			name: "Vormerkbank",
			type: "current",
			currency: "EUR",
			openingBalanceMinor: 10_000,
			openingBalanceDate: addMonths(today, -2),
		});
		const heldDate = addDays(today, -20);
		await insertTransactions(
			userId,
			account.id,
			[
				{
					bookingDate: heldDate,
					amountMinor: -8_000,
					description: "Hotel Reservierung",
					externalId: "enable-banking:hold-1",
					status: "pending",
				},
				{
					bookingDate: heldDate,
					amountMinor: -1_500,
					description: "Mietwagen Kaution",
					externalId: "enable-banking:hold-2",
					status: "pending",
					notes: "Kommt zurück",
				},
				{
					bookingDate: addDays(today, -30),
					amountMinor: -2_000,
					description: "Alte Buchung",
					externalId: "enable-banking:booked-old",
				},
			],
			{ importSource: "provider:enable-banking" },
		);
		// The bank now reports the final booking under a new reference and
		// amount, and no longer mentions the hold.
		const read = [
			{
				bookingDate: addDays(today, -18),
				amountMinor: -7_450,
				currency: "EUR",
				description: "Hotel Rechnung",
				externalId: "enable-banking:final-1",
			},
		];
		await insertTransactions(userId, account.id, read, {
			importSource: "provider:enable-banking",
		});
		expect(await expireUnreportedPending(account.id, read, null, today)).toBe(
			1,
		);
		const rows = await db
			.select({
				description: transactions.description,
				status: transactions.status,
			})
			.from(transactions)
			.where(eq(transactions.accountId, account.id));
		// The booked rows stay, reported or not; the hold the owner annotated
		// stays; only the untouched hold is gone.
		expect(rows.map((row) => row.description).sort()).toEqual([
			"Alte Buchung",
			"Hotel Rechnung",
			"Mietwagen Kaution",
		]);
		// A second read changes nothing.
		expect(await expireUnreportedPending(account.id, read, null, today)).toBe(
			0,
		);
	});

	it("links a PayPal funding debit once and reports only new links", async () => {
		const [connection] = await db
			.insert(bankConnections)
			.values({
				userId,
				provider: "enable-banking",
				institutionName: "PayPal",
				status: "active",
				encryptedSecret: encryptSecret(
					JSON.stringify({ sessionId: "pp", accountUids: ["pp-uid"] }),
				),
			})
			.returning();
		const [paypal] = await db
			.insert(accounts)
			.values({
				userId,
				name: "PayPal",
				type: "wallet",
				currency: "EUR",
				syncStatus: "synced",
				bankConnectionId: connection.id,
				providerAccountId: "pp-uid",
			})
			.returning();
		const bank = await createAccount(userId, {
			name: "Giro PayPal",
			type: "current",
			currency: "EUR",
			openingBalanceMinor: 100_000,
			openingBalanceDate: addMonths(today, -1),
		});
		await insertTransactions(
			userId,
			paypal.id,
			[
				{
					bookingDate: addDays(today, -5),
					amountMinor: -4_999,
					description: "Buchhandlung",
				},
			],
			{ importSource: "test" },
		);
		const bankLeg = await insertTransactions(
			userId,
			bank.id,
			[
				{
					bookingDate: addDays(today, -4),
					amountMinor: -4_999,
					description: "PayPal (Europe) S.a r.l. et Cie, S.C.A.",
				},
			],
			{ importSource: "test" },
		);
		expect(await linkPaypalFunding(userId)).toEqual({ linked: 1 });
		// Run again, as every sync does: nothing new, nothing counted.
		expect(await linkPaypalFunding(userId)).toEqual({ linked: 0 });
		const [row] = await db
			.select({ slug: categories.slug })
			.from(transactions)
			.innerJoin(categories, eq(categories.id, transactions.categoryId))
			.where(
				and(
					eq(transactions.id, bankLeg.inserted[0]),
					eq(transactions.userId, userId),
				),
			);
		expect(row?.slug).toBe("paypal-funding");
	});
});
