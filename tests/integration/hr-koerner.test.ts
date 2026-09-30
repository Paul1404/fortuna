import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIso } from "@/domain/dates";
import { db, pool } from "@/server/db";
import { user } from "@/server/db/auth-schema";
import { createAccount } from "@/server/services/accounts";
import {
	estimatePurchaseImpact,
	getFinancialProfile,
	getInvestmentRules,
	listObservations,
	reserveFor,
	reviewDue,
	updateFinancialProfile,
	updateObservation,
} from "@/server/services/hr-koerner";
import { insertTransactions } from "@/server/services/transactions";

const d =
	process.env.FORTUNA_INTEGRATION_TEST === "1" ? describe : describe.skip;

d("Hr. Körner persistence against PostgreSQL", () => {
	const userId = `it-${randomUUID()}`;
	const otherUserId = `it-${randomUUID()}`;
	beforeAll(async () => {
		await db.insert(user).values([
			{ id: userId, name: "Körner Test", email: `${userId}@example.invalid` },
			{
				id: otherUserId,
				name: "Other Test",
				email: `${otherUserId}@example.invalid`,
			},
		]);
	});
	afterAll(async () => {
		await db.delete(user).where(eq(user.id, userId));
		await db.delete(user).where(eq(user.id, otherUserId));
		await pool.end();
	});

	it("persists explicit goals and creates one deduplicated finding", async () => {
		await updateFinancialProfile(userId, {
			minimumCashReserveMinor: 1_000_000,
			targetNetWorthMinor: 10_000_000,
			monthlySavingsTargetMinor: 300_000,
			targetNetWorthDate: addDays(todayIso(), 365),
		});
		expect(await getFinancialProfile(userId)).toMatchObject({
			minimumCashReserveMinor: 1_000_000,
			targetNetWorthMinor: 10_000_000,
		});
		expect(await reviewDue(userId, true)).toMatchObject({
			attempted: true,
			created: 1,
		});
		expect(await reviewDue(userId)).toMatchObject({
			attempted: false,
			created: 0,
		});
		expect(await reviewDue(userId, true)).toMatchObject({
			attempted: true,
			created: 0,
		});
		const findings = await listObservations(userId);
		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({
			type: "liquidity_below_floor",
			impactMinor: 1_000_000,
			status: "open",
		});
	});

	it("keeps the owner's investment rules apart from the shared profile", async () => {
		expect(await getInvestmentRules(otherUserId)).toEqual({ rules: null });
		await updateFinancialProfile(userId, {
			investmentRules:
				"  Ich verkaufe nur nach Plan.  \r\n\r\n\r\nIm Crash: nichts.\n",
		});
		expect(await getInvestmentRules(userId)).toEqual({
			rules: "Ich verkaufe nur nach Plan.\n\nIm Crash: nichts.",
		});
		// The profile feeds the Copilot and the MCP; the rules are not in it.
		expect(await getFinancialProfile(userId)).not.toHaveProperty(
			"investmentRules",
		);
		// Saving the goals leaves the rules alone; a blank note clears them.
		await updateFinancialProfile(userId, {
			reserveMonths: (await getFinancialProfile(userId)).reserveMonths,
		});
		expect((await getInvestmentRules(userId)).rules).not.toBeNull();
		await updateFinancialProfile(userId, { investmentRules: "  \n " });
		expect(await getInvestmentRules(userId)).toEqual({ rules: null });
		expect(await getInvestmentRules(otherUserId)).toEqual({ rules: null });
	});

	it("calculates a bounded hypothetical purchase without changing balances", async () => {
		const estimate = await estimatePurchaseImpact(userId, {
			amountMinor: 180_000,
			currency: "EUR",
		});
		expect(estimate).toMatchObject({
			available: true,
			cashBeforeMinor: 0,
			cashAfterMinor: -180_000,
			reserveShortfallMinor: 1_180_000,
			goalDelayDays: 19,
		});
		expect(
			(
				await estimatePurchaseImpact(userId, {
					amountMinor: 180_000,
					currency: "USD",
				})
			).available,
		).toBe(false);
	});

	it("preserves intentional decisions and enforces owner scope", async () => {
		const [finding] = await listObservations(userId);
		await expect(
			updateObservation(otherUserId, { id: finding.id, status: "dismissed" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await updateObservation(userId, {
			id: finding.id,
			status: "snoozed",
			snoozedUntil: new Date(Date.now() + 7 * 86_400_000),
		});
		await reviewDue(userId, true);
		expect((await listObservations(userId))[0].status).toBe("snoozed");
		await updateObservation(userId, { id: finding.id, status: "intentional" });
		await reviewDue(userId, true);
		expect((await listObservations(userId))[0].status).toBe("intentional");
	});

	it("does not read a monthly average out of two weeks of bookings", async () => {
		const account = await createAccount(otherUserId, {
			name: "Giro",
			type: "current",
			currency: "EUR",
		});
		const today = todayIso();
		await insertTransactions(
			otherUserId,
			account.id,
			[3, 8, 13].map((days) => ({
				bookingDate: addDays(today, -days),
				amountMinor: -60_000,
				currency: "EUR",
				description: `Einkauf ${days}`,
			})),
			{ importSource: "test" },
		);
		await updateFinancialProfile(otherUserId, {
			minimumCashReserveMinor: 500_000,
			reserveMonths: 6,
		});
		const reserve = await reserveFor(otherUserId);
		expect(reserve.basis).not.toBe("history");
		expect(reserve.reserveMinor).toBe(500_000);
		expect(reserve.binding).toBe("minimum");
	});
});
