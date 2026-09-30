import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, addMonths, daysInMonth, todayIso } from "@/domain/dates";
import { db, pool } from "@/server/db";
import { user } from "@/server/db/auth-schema";
import { recurringPayments, transactions } from "@/server/db/schema";
import { createAccount } from "@/server/services/accounts";
import { createCategory } from "@/server/services/categories";
import { createContract, updateContract } from "@/server/services/contracts";
import { cashflowForecast } from "@/server/services/forecast";
import {
	createOptimization,
	listOptimizations,
} from "@/server/services/optimizations";
import {
	createRecurring,
	deleteRecurring,
	detectRecurringAfterImport,
	linkTransactionToRecurring,
	runRecurringDetection,
	updateRecurring,
} from "@/server/services/recurring";
import { insertTransactions } from "@/server/services/transactions";

// Shaped like a real owner's first months with a connected bank: three
// payments entered by hand before detection ever ran (an insurance premium
// with no booking linked and no due date, a TV subscription with one booking
// linked, an investment rate with all of them), and a mobile contract nobody
// entered. All names, numbers and texts are invented.

const enabled = process.env.FORTUNA_INTEGRATION_TEST === "1";
const d = enabled ? describe : describe.skip;

d("recurring detection with the owner's own payments", () => {
	const userId = `it-${randomUUID()}`;
	const today = todayIso();
	/** The `day` of the month `monthsAgo` months back, never in the future. */
	const on = (monthsAgo: number, day: number) => {
		const month = addMonths(`${today.slice(0, 8)}01`, -monthsAgo);
		return `${month.slice(0, 8)}${String(Math.min(day, daysInMonth(month))).padStart(2, "0")}`;
	};
	let giro = "";
	let insurance = "";
	let car = "";
	let telecom = "";
	let invest = "";

	const rowsFor = (recurringPaymentId: string) =>
		db
			.select({ id: transactions.id })
			.from(transactions)
			.where(eq(transactions.recurringPaymentId, recurringPaymentId));

	beforeAll(async () => {
		await db.insert(user).values({
			id: userId,
			name: "Integration",
			email: `${userId}@example.invalid`,
		});
		giro = (
			await createAccount(userId, {
				name: "Giro",
				type: "current",
				currency: "EUR",
				openingBalanceMinor: 500_000,
				openingBalanceDate: addMonths(today, -6),
			})
		).id;
		insurance = (
			await createCategory(userId, { name: "Unfall", kind: "expense" })
		).id;
		car = (await createCategory(userId, { name: "Kfz", kind: "expense" })).id;
		telecom = (
			await createCategory(userId, { name: "Telefon", kind: "expense" })
		).id;
		invest = (
			await createCategory(userId, { name: "Anlage", kind: "transfer" })
		).id;
	});

	afterAll(async () => {
		await db.delete(user).where(eq(user.id, userId));
		await pool.end();
	});

	it("links bookings to the payments the owner entered instead of copying them", async () => {
		const premium = await createRecurring(userId, {
			name: "Unfallversicherung",
			accountId: giro,
			categoryId: insurance,
			direction: "outflow",
			expectedAmountMinor: -2_270,
			currency: "EUR",
			frequency: "monthly",
			typicalDay: 15,
			windowDays: 3,
		});
		// The edit form sends an empty date as null.
		await updateRecurring(userId, { id: premium.id, nextExpected: null });
		const tv = await createRecurring(userId, {
			name: "TV-Abo",
			accountId: giro,
			categoryId: telecom,
			direction: "outflow",
			expectedAmountMinor: -1_000,
			currency: "EUR",
			frequency: "monthly",
			typicalDay: 14,
		});
		const rate = await createRecurring(userId, {
			name: "Fondsrate",
			accountId: giro,
			categoryId: invest,
			direction: "outflow",
			expectedAmountMinor: -4_200,
			currency: "EUR",
			frequency: "monthly",
			typicalDay: 15,
		});
		const telco = "Beispiel Telefon GmbH";
		await insertTransactions(
			userId,
			giro,
			[
				// The first premium was filed under the wrong category by hand.
				...[3, 2, 1].map((monthsAgo, i) => ({
					bookingDate: on(monthsAgo, 15 - (i % 2)),
					amountMinor: -2_270,
					description: `Z0001 Unfall EREF: ${i}`,
					counterpartyName: "Beispiel Versicherung",
					categoryId: i === 0 ? car : insurance,
					externalId: `ins-${i}`,
				})),
				...[3, 2, 1].map((monthsAgo, i) => ({
					bookingDate: on(monthsAgo, 13 + i),
					amountMinor: -1_000,
					description: `TV Kundennummer 111 RG 00${i}`,
					counterpartyName: telco,
					categoryId: telecom,
					externalId: `tv-${i}`,
				})),
				...[4, 3, 2, 1].map((monthsAgo, i) => ({
					bookingDate: on(monthsAgo, 28),
					amountMinor: [-3_504, -3_495, -3_517, -3_495][i],
					description: `Mobilfunk Kundenkonto 222 RG 99${i}`,
					counterpartyName: telco,
					categoryId: telecom,
					externalId: `mob-${i}`,
				})),
				...[3, 2, 1].map((monthsAgo, i) => ({
					bookingDate: on(monthsAgo, 15),
					amountMinor: -4_200,
					description: `Mtl. Rate Fonds Vertr. K1-${i}`,
					counterpartyName: "Beispiel Fonds AG",
					categoryId: invest,
					externalId: `rate-${i}`,
				})),
			],
			{ importSource: "test" },
		);
		const tvBookings = await db
			.select({ id: transactions.id })
			.from(transactions)
			.where(
				and(
					eq(transactions.userId, userId),
					eq(transactions.amountMinor, -1_000),
				),
			);
		await linkTransactionToRecurring(userId, tvBookings[0].id, tv.id);
		for (const row of await db
			.select({ id: transactions.id })
			.from(transactions)
			.where(
				and(
					eq(transactions.userId, userId),
					eq(transactions.amountMinor, -4_200),
				),
			))
			await linkTransactionToRecurring(userId, row.id, rate.id);

		const result = await runRecurringDetection(userId);
		const rows = await db
			.select()
			.from(recurringPayments)
			.where(eq(recurringPayments.userId, userId));
		// Only the mobile contract is new; the three manual payments stay single.
		expect(result.created).toBe(1);
		expect(rows).toHaveLength(4);
		const detected = rows.filter((row) => row.matchKey);
		expect(detected.map((row) => row.expectedAmountMinor)).toEqual([-3_500]);

		expect(await rowsFor(premium.id)).toHaveLength(3);
		expect(await rowsFor(tv.id)).toHaveLength(3);
		expect(await rowsFor(rate.id)).toHaveLength(3);
		const after = rows.find((row) => row.id === premium.id);
		expect(after?.lastOccurrence).toBe(on(1, 15));
		expect(after?.nextExpected).toBe(on(0, 15));
		// The owner's own fields are untouched.
		expect(after?.name).toBe("Unfallversicherung");
		expect(after?.matchKey).toBeNull();

		const again = await runRecurringDetection(userId);
		expect(again.created).toBe(0);
		expect(
			await db
				.select({ id: recurringPayments.id })
				.from(recurringPayments)
				.where(eq(recurringPayments.userId, userId)),
		).toHaveLength(4);
	});

	it("runs after an import, and a removed detection stays removed", async () => {
		await insertTransactions(
			userId,
			giro,
			[1, 2, 3].map((monthsAgo) => ({
				bookingDate: on(monthsAgo, 3),
				amountMinor: -999,
				description: "Beispiel Streaming Abo",
				externalId: `stream-${monthsAgo}`,
			})),
			{ importSource: "test" },
		);
		await detectRecurringAfterImport(userId);
		const streaming = await db.query.recurringPayments.findFirst({
			where: and(
				eq(recurringPayments.userId, userId),
				eq(recurringPayments.expectedAmountMinor, -999),
			),
		});
		expect(streaming?.detectedAutomatically).toBe(true);
		expect(await rowsFor(streaming?.id as string)).toHaveLength(3);

		// The owner does not want it. Detection runs after every sync now, so
		// a plain delete would bring it straight back.
		await deleteRecurring(userId, streaming?.id as string);
		await detectRecurringAfterImport(userId);
		const back = await db
			.select()
			.from(recurringPayments)
			.where(
				and(
					eq(recurringPayments.userId, userId),
					eq(recurringPayments.expectedAmountMinor, -999),
				),
			);
		expect(back).toHaveLength(1);
		expect(back[0].isActive).toBe(false);

		// A payment the owner entered is still deleted outright.
		const manual = await createRecurring(userId, {
			name: "Einmal angelegt",
			direction: "outflow",
			expectedAmountMinor: -123,
			currency: "EUR",
			frequency: "yearly",
		});
		await deleteRecurring(userId, manual.id);
		expect(
			await db.query.recurringPayments.findFirst({
				where: eq(recurringPayments.id, manual.id),
			}),
		).toBeUndefined();
	});

	it("forecasts a monthly payment without a due date on its typical day", async () => {
		const typical = Number(today.slice(8)) === 20 ? 21 : 20;
		const rent = await createRecurring(userId, {
			name: "Stellplatz",
			direction: "outflow",
			expectedAmountMinor: -5_000,
			currency: "EUR",
			frequency: "monthly",
			typicalDay: typical,
		});
		await updateRecurring(userId, { id: rent.id, nextExpected: null });
		const forecast = await cashflowForecast(userId, { horizonDays: 40 });
		const dates = forecast.events
			.filter((event) => event.sourceId === rent.id)
			.map((event) => event.date);
		expect(dates.length).toBeGreaterThan(0);
		expect(dates).not.toContain(today);
		for (const date of dates)
			expect(Number(date.slice(8))).toBe(Math.min(typical, daysInMonth(date)));
		await db.delete(recurringPayments).where(eq(recurringPayments.id, rent.id));
	});

	it("dates a Sparmission by the contract behind its payment", async () => {
		const payment = await createRecurring(userId, {
			name: "Zeitschrift",
			direction: "outflow",
			expectedAmountMinor: -800,
			currency: "EUR",
			frequency: "monthly",
		});
		const contract = await createContract(userId, {
			name: "Zeitschrift",
			category: "subscription",
			status: "active",
			costMinor: 800,
			currency: "EUR",
			frequency: "monthly",
			recurringPaymentId: payment.id,
		});
		// The mission names the payment, not the contract.
		const mission = await createOptimization(userId, {
			title: "Zeitschrift kündigen",
			category: "subscription",
			currency: "EUR",
			currentMonthlyMinor: 800,
			alternativeMonthlyMinor: 0,
			oneTimeCostMinor: 0,
			status: "completed",
			recurringPaymentId: payment.id,
		});
		const read = async () =>
			(await listOptimizations(userId)).find((row) => row.id === mission.id)
				?.progress;
		// The contract still runs, so the date belongs on the contract.
		expect(await read()).toMatchObject({
			phase: "undated",
			missing: "contract_end",
		});
		const end = addDays(today, 18);
		await updateContract(userId, {
			id: contract.id,
			status: "cancelled",
			endDate: end,
		});
		expect(await read()).toMatchObject({
			phase: "waiting",
			savingFrom: addDays(end, 1),
		});
	});
});
