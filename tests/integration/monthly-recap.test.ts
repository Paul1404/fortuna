import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMonths, todayIso } from "@/domain/dates";
import { db, pool } from "@/server/db";
import { user } from "@/server/db/auth-schema";
import { deskRecapReads, financialObservations } from "@/server/db/schema";
import { createAccount } from "@/server/services/accounts";
import { createCategory } from "@/server/services/categories";
import {
	createContract,
	listContracts,
	updateContract,
} from "@/server/services/contracts";
import { cashflowForecast } from "@/server/services/forecast";
import {
	fixedCostTrend,
	reviewDue,
	updateObservation,
} from "@/server/services/hr-koerner";
import {
	deskRecap,
	markRecapRead,
	monthlyRecap,
} from "@/server/services/monthly-recap";
import { insertTransactions } from "@/server/services/transactions";

const d =
	process.env.FORTUNA_INTEGRATION_TEST === "1" ? describe : describe.skip;

d("month recap on the desk", () => {
	const userId = `it-${randomUUID()}`;

	beforeAll(async () => {
		await db.insert(user).values({
			id: userId,
			name: "Recap Test",
			email: `${userId}@example.invalid`,
		});
		const account = await createAccount(userId, {
			name: "Giro",
			type: "current",
			currency: "EUR",
		});
		const salary = await createCategory(userId, {
			name: "Gehalt Test",
			kind: "income",
		});
		const rent = await createCategory(userId, { name: "Wohnen Test" });
		const food = await createCategory(userId, { name: "Essen Test" });
		const rows = [];
		for (const month of ["2026-06", "2026-07", "2026-08"]) {
			rows.push(
				{
					bookingDate: `${month}-01`,
					amountMinor: 400_000,
					currency: "EUR",
					description: `Gehalt ${month}`,
					counterpartyName: "Arbeitgeber GmbH",
					categoryId: salary.id,
				},
				{
					bookingDate: `${month}-03`,
					amountMinor: -120_000,
					currency: "EUR",
					description: `Miete ${month}`,
					counterpartyName: "Vermieter",
					categoryId: rent.id,
				},
			);
			for (let day = 5; day <= 25; day += 5)
				rows.push({
					bookingDate: `${month}-${String(day).padStart(2, "0")}`,
					amountMinor: month === "2026-08" ? -8_000 : -6_000,
					currency: "EUR",
					description: `Einkauf ${month}-${day}`,
					counterpartyName: `Markt ${day}`,
					categoryId: food.id,
				});
		}
		await insertTransactions(userId, account.id, rows, {
			importSource: "test",
		});
	});

	afterAll(async () => {
		await db.delete(user).where(eq(user.id, userId));
	});

	it("shows last month's recap on the first days of the month", async () => {
		const recap = await deskRecap(userId, "2026-09-03");
		expect(recap?.month).toBe("2026-08");
		expect(recap?.title).toBe("Ihr August in drei Sätzen");
		expect(recap?.enoughData).toBe(true);
		expect(recap?.numbers).toMatchObject({
			incomeMinor: 400_000,
			expenseMinor: 160_000,
			netMinor: 240_000,
			// 5 × 20 € more for food than in July.
			expenseChangeMinor: 10_000,
			topCategory: { name: "Wohnen Test", amountMinor: 120_000 },
		});
		expect(recap?.sentences).toHaveLength(3);
		// After the first days it is old news.
		expect(await deskRecap(userId, "2026-09-11")).toBeNull();
	});

	it("leaves the desk for good once read, and stays reachable", async () => {
		await markRecapRead(userId, "2026-08");
		// Idempotent: a second tap on another device changes nothing.
		await markRecapRead(userId, "2026-08");
		const reads = await db
			.select()
			.from(deskRecapReads)
			.where(
				and(
					eq(deskRecapReads.userId, userId),
					eq(deskRecapReads.month, "2026-08"),
				),
			);
		expect(reads).toHaveLength(1);
		expect(await deskRecap(userId, "2026-09-03")).toBeNull();
		const past = await monthlyRecap(userId, "2026-08", "2026-09-03");
		expect(past.enoughData).toBe(true);
	});

	it("is honest about a month without enough bookings", async () => {
		const may = await monthlyRecap(userId, "2026-05", "2026-09-03");
		expect(may.enoughData).toBe(false);
		expect(may.sentences[0]).toBe("Für Mai liegen zu wenige Buchungen vor.");
		// The first month compares with nothing.
		const june = await monthlyRecap(userId, "2026-06", "2026-09-03");
		expect(june.numbers.expenseChangeMinor).toBeNull();
		await expect(
			monthlyRecap(userId, "2026-09", "2026-09-03"),
		).rejects.toThrow();
	});
});

/** The latest full calendar quarter before today, as the creep rule sees it. */
function latestFullQuarter(today: string) {
	const last = addMonths(`${today.slice(0, 7)}-01`, -1);
	const quarterStart = (iso: string) => {
		const month = Number(iso.slice(5, 7));
		return `${iso.slice(0, 5)}${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
	};
	let start = quarterStart(last);
	if (addMonths(start, 2) > last) start = quarterStart(addMonths(start, -3));
	const q = Math.floor((Number(start.slice(5, 7)) - 1) / 3) + 1;
	return { start, key: `${start.slice(0, 4)}-Q${q}` };
}

d("lifestyle creep and payroll contracts", () => {
	const userId = `it-${randomUUID()}`;
	const today = todayIso();
	const quarter = latestFullQuarter(today);
	let pensionId = "";

	beforeAll(async () => {
		await db.insert(user).values({
			id: userId,
			name: "Creep Test",
			email: `${userId}@example.invalid`,
		});
		const account = await createAccount(userId, {
			name: "Giro",
			type: "current",
			currency: "EUR",
		});
		const salary = await createCategory(userId, {
			name: "Gehalt Test",
			kind: "income",
		});
		// Salary from four months before the quarter: the month before that
		// quarter is the first full one, so the quarter before is covered.
		const first = addMonths(quarter.start, -4);
		const rows = [];
		for (
			let month = first;
			month <= addMonths(`${today.slice(0, 7)}-01`, -1);
			month = addMonths(month, 1)
		)
			rows.push({
				bookingDate: month,
				amountMinor: 400_000,
				currency: "EUR",
				description: `Gehalt ${month}`,
				counterpartyName: "Arbeitgeber GmbH",
				categoryId: salary.id,
			});
		await insertTransactions(userId, account.id, rows, {
			importSource: "test",
		});
		await createContract(userId, {
			name: "Miete",
			costMinor: 100_000,
			currency: "EUR",
			frequency: "monthly",
			startDate: addMonths(quarter.start, -24),
			accountId: account.id,
		});
		// The company pension starts with the quarter: paid by the employer,
		// it is no fixed cost of the account and must not look like creep.
		pensionId = (
			await createContract(userId, {
				name: "Direktversicherung",
				category: "insurance",
				costMinor: 33_800,
				currency: "EUR",
				frequency: "monthly",
				startDate: quarter.start,
				paidVia: "payroll",
			})
		).id;
	});

	afterAll(async () => {
		await db.delete(user).where(eq(user.id, userId));
		await pool.end();
	});

	it("keeps a payroll-paid contract out of the trend, the forecast and the missing-link check", async () => {
		const trend = await fixedCostTrend(userId, today, "EUR");
		expect(trend.months.length).toBeGreaterThanOrEqual(6);
		expect(new Set(trend.months.map((row) => row.fixedCostsMinor))).toEqual(
			new Set([100_000]),
		);
		await reviewDue(userId, true);
		const findings = await db
			.select()
			.from(financialObservations)
			.where(eq(financialObservations.userId, userId));
		expect(findings.filter((row) => row.type === "lifestyle_creep")).toEqual(
			[],
		);
		const forecast = await cashflowForecast(userId, { horizonDays: 90 });
		const names = new Set(forecast.events.map((event) => event.name));
		expect(names.has("Miete")).toBe(true);
		expect(names.has("Direktversicherung")).toBe(false);
		expect(forecast.assumptions.contractGaps).toEqual([]);
		const pension = (await listContracts(userId)).find(
			(row) => row.id === pensionId,
		);
		expect(pension?.paidVia).toBe("payroll");
		expect(pension?.missingFields).not.toContain(
			"Konto oder wiederkehrende Zahlung",
		);
	});

	it("observes creep once per quarter and keeps the owner's decision", async () => {
		// The same pension paid from the account is a new fixed cost: +34 %.
		await updateContract(userId, { id: pensionId, paidVia: "account" });
		await reviewDue(userId, true);
		const creep = async () =>
			db
				.select()
				.from(financialObservations)
				.where(
					and(
						eq(financialObservations.userId, userId),
						eq(financialObservations.type, "lifestyle_creep"),
					),
				);
		const [finding, ...more] = await creep();
		expect(more).toEqual([]);
		expect(finding).toMatchObject({
			key: `lifestyle_creep:${quarter.key}`,
			severity: "info",
			status: "open",
			impactMinor: 33_800,
		});
		await updateObservation(userId, { id: finding.id, status: "intentional" });
		await reviewDue(userId, true);
		const after = await creep();
		expect(after).toHaveLength(1);
		expect(after[0].status).toBe("intentional");
	});
});
