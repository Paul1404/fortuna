import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIso } from "@/domain/dates";
import { db, pool } from "@/server/db";
import { user } from "@/server/db/auth-schema";
import { merchants, transactions } from "@/server/db/schema";
import { createAccount } from "@/server/services/accounts";
import { createCategory } from "@/server/services/categories";
import { deskToday, fileCertain, unfile } from "@/server/services/desk";
import { currentNetWorth } from "@/server/services/net-worth";
import {
	insertTransactions,
	updateTransaction,
} from "@/server/services/transactions";

const d =
	process.env.FORTUNA_INTEGRATION_TEST === "1" ? describe : describe.skip;

d("Hr. Körner's desk", () => {
	const userId = `it-${randomUUID()}`;
	let bread = "";
	let fuel = "";
	let other = "";
	let kraus: string[] = [];
	let aral: string[] = [];
	let unknown = "";
	let filed: string[] = [];

	const row = async (id: string) => {
		const [found] = await db
			.select({
				categoryId: transactions.categoryId,
				categorySource: transactions.categorySource,
			})
			.from(transactions)
			.where(eq(transactions.id, id));
		return found;
	};

	beforeAll(async () => {
		await db.insert(user).values({
			id: userId,
			name: "Desk Test",
			email: `${userId}@example.invalid`,
		});
		const account = await createAccount(userId, {
			name: "Giro",
			type: "current",
			currency: "EUR",
		});
		bread = (await createCategory(userId, { name: "Brot" })).id;
		fuel = (await createCategory(userId, { name: "Tanken" })).id;
		other = (await createCategory(userId, { name: "Sonstiges Test" })).id;
		const today = todayIso();
		const booking = (
			days: number,
			amountMinor: number,
			counterpartyName: string,
			description: string,
		) => ({
			bookingDate: addDays(today, -days),
			amountMinor,
			currency: "EUR",
			description,
			counterpartyName,
		});
		const result = await insertTransactions(
			userId,
			account.id,
			[
				booking(40, -350, "Bäckerei Kraus", "Kartenzahlung 1"),
				booking(30, -420, "Bäckerei Kraus", "Kartenzahlung 2"),
				booking(20, -380, "Bäckerei Kraus", "Kartenzahlung 3"),
				booking(10, -510, "Bäckerei Kraus", "Kartenzahlung 4"),
				booking(15, -6_500, "Aral Tankstelle", "Tankstelle 1"),
				booking(5, -7_200, "Aral Tankstelle", "Tankstelle 2"),
				booking(3, -9_900, "Niemand Bekanntes", "Einmalig"),
			],
			{ importSource: "test" },
		);
		const [k1, k2, k3, k4, a1, a2, u] = result.inserted;
		kraus = [k1, k2, k3, k4];
		aral = [a1, a2];
		unknown = u;

		// The owner filed the first two Kraus bookings by hand: an unbroken
		// history that makes the next ones certain.
		await updateTransaction(userId, { id: k1, categoryId: bread });
		await updateTransaction(userId, { id: k2, categoryId: bread });
		// A booking the owner deliberately left open by hand stays theirs.
		await db
			.update(transactions)
			.set({ categoryId: null, categorySource: "manual" })
			.where(eq(transactions.id, k4));
		// And a merchant default for the petrol station.
		await db
			.update(merchants)
			.set({ defaultCategoryId: fuel })
			.where(
				and(
					eq(merchants.userId, userId),
					eq(merchants.name, "Aral Tankstelle"),
				),
			);
	});

	afterAll(async () => {
		await db.delete(user).where(eq(user.id, userId));
		await pool.end();
	});

	it("files what repeats the owner's own decisions, as auto", async () => {
		const result = await fileCertain(userId);
		filed = result.transactionIds;
		expect([...filed].sort()).toEqual([kraus[2], ...aral].sort());
		expect(result.count).toBe(3);
		expect(result.summary).toEqual([
			"Aral Tankstelle → Tanken (2)",
			"Bäckerei Kraus → Brot (1)",
		]);
		expect(await row(kraus[2])).toEqual({
			categoryId: bread,
			categorySource: "auto",
		});
		expect(await row(aral[0])).toEqual({
			categoryId: fuel,
			categorySource: "auto",
		});
		// A guess is not filed.
		expect(await row(unknown)).toEqual({
			categoryId: null,
			categorySource: null,
		});
	});

	it("never touches a manual row", async () => {
		expect(await row(kraus[0])).toEqual({
			categoryId: bread,
			categorySource: "manual",
		});
		expect(await row(kraus[3])).toEqual({
			categoryId: null,
			categorySource: "manual",
		});
	});

	it("is idempotent", async () => {
		const again = await fileCertain(userId);
		expect(again).toEqual({ count: 0, transactionIds: [], summary: [] });
	});

	it("undoes only the rows still exactly as he filed them", async () => {
		// The owner corrects one; a rule later claims another.
		await updateTransaction(userId, { id: aral[0], categoryId: other });
		await db
			.update(transactions)
			.set({ categorySource: "rule" })
			.where(eq(transactions.id, aral[1]));

		const result = await unfile(userId, filed);
		expect(result).toEqual({ cleared: 1 });
		expect(await row(kraus[2])).toEqual({
			categoryId: null,
			categorySource: null,
		});
		expect(await row(aral[0])).toEqual({
			categoryId: other,
			categorySource: "manual",
		});
		expect(await row(aral[1])).toEqual({
			categoryId: fuel,
			categorySource: "rule",
		});
		expect(await unfile(userId, filed)).toEqual({ cleared: 0 });
	});

	it("never unfiles another owner's bookings", async () => {
		const refiled = await fileCertain(userId);
		expect(refiled.transactionIds).toEqual([kraus[2]]);
		expect(
			await unfile(`other-${randomUUID()}`, refiled.transactionIds),
		).toEqual({ cleared: 0 });
		const [still] = await db
			.select({ categorySource: transactions.categorySource })
			.from(transactions)
			.where(inArray(transactions.id, refiled.transactionIds));
		expect(still.categorySource).toBe("auto");
	});

	it("assembles a desk whose liquidity reconciles with net worth", async () => {
		const [desk, worth] = await Promise.all([
			deskToday(userId),
			currentNetWorth(userId),
		]);
		const total = Object.values(desk.liquidity.totals).reduce(
			(sum, value) => sum + value,
			0,
		);
		expect(total).toBe(worth.totalAssetsMinor);
		expect(desk.baseCurrency).toBe(worth.baseCurrency);
		const review = desk.tasks.find((task) => task.key === "review_bookings");
		// Only the unknown booking is left for the owner; Kraus 4 is manual
		// but uncategorised, so it is still open too.
		expect(review?.title).toBe("2 Buchungen ohne Kategorie");
		// Without a depot there is nothing to buy into, so no "Freies Geld",
		// and no plan task exists any more.
		expect(desk.tasks.map((task) => task.key)).toEqual(["review_bookings"]);
	});
});
