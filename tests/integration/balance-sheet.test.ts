import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCsv } from "@/domain/csv";
import { addDays, addMonths, endOfMonth, todayIso } from "@/domain/dates";
import { db, pool } from "@/server/db";
import { user } from "@/server/db/auth-schema";
import {
	accounts,
	investmentSourceAccounts,
	investmentSourcePositions,
} from "@/server/db/schema";
import { createAccount } from "@/server/services/accounts";
import { createAsset, listAssets } from "@/server/services/assets";
import { createContract } from "@/server/services/contracts";
import { exportOptimizationsCsv } from "@/server/services/export";
import { dataQuality } from "@/server/services/insights";
import {
	createLiability,
	listLiabilities,
	updateLiability,
} from "@/server/services/liabilities";
import {
	currentNetWorth,
	holdingsBreakdown,
	netWorthAt,
	netWorthHistory,
} from "@/server/services/net-worth";
import {
	createOptimization,
	listOptimizations,
} from "@/server/services/optimizations";
import { applySnapshot, type RemiseSnapshot } from "@/server/services/remise";
import { insertTransactions } from "@/server/services/transactions";

// Runs against a real PostgreSQL (DATABASE_URL), like finance-flows.
const enabled = process.env.FORTUNA_INTEGRATION_TEST === "1";
const d = enabled ? describe : describe.skip;

d("balance sheet against PostgreSQL", () => {
	const userId = `it-${randomUUID()}`;
	const today = todayIso();

	beforeAll(async () => {
		await db.insert(user).values({
			id: userId,
			name: "Integration",
			email: `${userId}@example.invalid`,
		});
	});

	afterAll(async () => {
		await db.delete(user).where(eq(user.id, userId));
		await pool.end();
	});

	it("keeps a closed loan in past net worth and out of today's", async () => {
		const lastMonth = addMonths(today, -1);
		const before = await currentNetWorth(userId);
		const beforeLastMonth = await netWorthAt(userId, lastMonth);
		// The dialog sends every field; an empty end date arrives as null.
		const open = await createLiability(userId, {
			name: "Privatkredit",
			type: "personal_loan",
			currency: "EUR",
			currentBalanceMinor: 500_000,
			balanceDate: addMonths(today, -3),
		});
		// A mortgage carries its contractual term end, years ahead.
		const termed = await createLiability(userId, {
			name: "Baufinanzierung",
			type: "mortgage",
			currency: "EUR",
			currentBalanceMinor: 1_000_000,
			balanceDate: addMonths(today, -3),
			endDate: addMonths(today, 12 * 14),
		});
		await updateLiability(userId, {
			id: open.id,
			isActive: false,
			endDate: null,
		});
		await updateLiability(userId, {
			id: termed.id,
			isActive: false,
			endDate: termed.endDate,
		});
		const now = await currentNetWorth(userId);
		expect(now.totalLiabilitiesMinor).toBe(before.totalLiabilitiesMinor);
		const past = await netWorthAt(userId, lastMonth);
		expect(
			past.totalLiabilitiesMinor - beforeLastMonth.totalLiabilitiesMinor,
		).toBe(1_500_000);
		const rows = await listLiabilities(userId, { includeInactive: true });
		expect(rows.find((row) => row.id === open.id)?.endDate).toBe(today);
		expect(rows.find((row) => row.id === termed.id)?.endDate).toBe(today);
	});

	it("counts a connected account for the months its bookings cover", async () => {
		// A bank connected today delivers its balance as of today and the last
		// months of bookings. The account row is new; the money is not.
		const past = addMonths(today, -2);
		const pastMonthEnd = endOfMonth(addMonths(today, -1));
		const beforeFirst = addDays(addMonths(today, -3), -1);
		const beforeEarly = await netWorthAt(userId, beforeFirst);
		const beforePast = await netWorthAt(userId, past);
		const beforeMonthEnd = (await netWorthHistory(userId, 3)).find(
			(point) => point.date === pastMonthEnd,
		);
		const account = await createAccount(userId, {
			name: "Girokonto",
			type: "current",
			currency: "EUR",
			openingBalanceMinor: 400_000,
			openingBalanceDate: today,
		});
		await insertTransactions(
			userId,
			account.id,
			[
				{
					bookingDate: addMonths(today, -3),
					amountMinor: 250_000,
					description: "Gehalt Beispiel GmbH",
				},
				{
					bookingDate: addDays(past, 1),
					amountMinor: -120_000,
					description: "Kartenabrechnung Beispielbank",
				},
			],
			{ importSource: "provider:test" },
		);
		// 400.000 today, before the later debit it was 520.000.
		const afterPast = await netWorthAt(userId, past);
		expect(afterPast.cashMinor - beforePast.cashMinor).toBe(520_000);
		const afterMonthEnd = (await netWorthHistory(userId, 3)).find(
			(point) => point.date === pastMonthEnd,
		);
		expect(
			(afterMonthEnd?.cashMinor ?? 0) - (beforeMonthEnd?.cashMinor ?? 0),
		).toBe(400_000);
		// Before its first booking there is nothing to reconstruct from.
		const early = await netWorthAt(userId, beforeFirst);
		expect(early.cashMinor).toBe(beforeEarly.cashMinor);
	});

	it("does not invent a wallet balance from its outgoing payments", async () => {
		// A payment wallet reports what it paid out, never the funding coming
		// in; walking back from today's zero would conjure a balance.
		const first = addMonths(today, -2);
		const past = addDays(first, 5);
		const beforePast = await netWorthAt(userId, past);
		const wallet = await createAccount(userId, {
			name: "Zahlungsdienst",
			type: "wallet",
			currency: "EUR",
			openingBalanceMinor: 0,
			openingBalanceDate: today,
		});
		await insertTransactions(
			userId,
			wallet.id,
			[
				{
					bookingDate: first,
					amountMinor: -10_000,
					description: "Beispielhändler Eins",
				},
				{
					bookingDate: addDays(first, 10),
					amountMinor: -90_000,
					description: "Beispielhändler Zwei",
				},
			],
			{ importSource: "provider:test" },
		);
		const afterPast = await netWorthAt(userId, past);
		expect(afterPast.cashMinor).toBe(beforePast.cashMinor);
	});

	it("walks an account without a balance reading back from its row", async () => {
		// A bank that could not report a balance leaves no observation, only the
		// balance on the account row.
		const past = addMonths(today, -2);
		const beforePast = await netWorthAt(userId, past);
		const [account] = await db
			.insert(accounts)
			.values({
				userId,
				name: "Tagesgeld",
				type: "savings",
				currency: "EUR",
				currentBalanceMinor: 300_000,
				balanceAsOf: today,
				syncStatus: "synced",
			})
			.returning();
		await insertTransactions(
			userId,
			account.id,
			[
				{
					bookingDate: addMonths(today, -3),
					amountMinor: 50_000,
					description: "Einzahlung Beispiel",
				},
				{
					bookingDate: addDays(past, 1),
					amountMinor: 80_000,
					description: "Zinsgutschrift Beispiel",
				},
			],
			{ importSource: "provider:test" },
		);
		const afterPast = await netWorthAt(userId, past);
		expect(afterPast.cashMinor - beforePast.cashMinor).toBe(220_000);
	});

	it("shows the depot's unitemised value in the holdings", async () => {
		// The provider's depot total includes a crypto subtotal that has no
		// holding row. Net worth counts the total; the holdings must too.
		const now = new Date();
		const [depot] = await db
			.insert(investmentSourceAccounts)
			.values({
				userId,
				provider: "scalable",
				sourceAccountId: "broker:holdings-portfolio",
				method: "cli",
				currency: "EUR",
				status: "active",
				cashBalanceMinor: 5_000,
				cashValuationAt: now,
				portfolioValueMinor: 100_000,
				cryptoValueMinor: 3_000,
				portfolioValuationAt: now,
			})
			.returning();
		await db.insert(investmentSourcePositions).values({
			userId,
			accountId: depot.id,
			instrumentName: "Welt-ETF Beispiel",
			isin: "IE0000000001",
			quantity: 10,
			valueMinor: 97_000,
			currency: "EUR",
			verification: "provider_reported",
			valuationAt: now,
		});
		const [snapshot, holdings] = await Promise.all([
			currentNetWorth(userId),
			holdingsBreakdown(userId),
		]);
		const sum = holdings.leaves.reduce(
			(total, leaf) => total + leaf.amountMinor,
			0,
		);
		expect(sum).toBe(snapshot.totalAssetsMinor);
		const rest = holdings.leaves.find(
			(leaf) => leaf.key === `source-rest-${depot.id}`,
		);
		expect(rest?.amountMinor).toBe(3_000);
		expect(rest?.group).toBe("investments");
	});

	it("reads a linked card's debt and date from its account", async () => {
		const card = await createAccount(userId, {
			name: "Kreditkarte",
			type: "credit_card",
			currency: "EUR",
			openingBalanceMinor: -30_000,
			openingBalanceDate: today,
		});
		// Created with the balance typed in months ago; nothing moves it since,
		// because the account carries the debt.
		const liability = await createLiability(userId, {
			name: "Kartenkredit",
			type: "credit_card",
			currency: "EUR",
			currentBalanceMinor: 120_000,
			balanceDate: addMonths(today, -3),
			interestRateBps: 1_800,
			linkedAccountId: card.id,
		});
		const row = (await listLiabilities(userId)).find(
			(candidate) => candidate.id === liability.id,
		);
		expect(row?.owedMinor).toBe(30_000);
		expect(row?.owedAsOf).toBe(today);
		const quality = await dataQuality(userId);
		const entry = quality.entries.find(
			(candidate) => candidate.id === liability.id,
		);
		expect(entry?.state).toBe("current");
	});

	it("exports no saving before a linked old contract has ended", async () => {
		const contract = await createContract(userId, {
			name: "Altes Handy",
			provider: "Mobilfunk AG",
			category: "telecom",
			status: "cancelled",
			costMinor: 3_500,
			currency: "EUR",
			frequency: "monthly",
			startDate: addMonths(today, -24),
			endDate: addDays(today, 40),
		});
		const mission = await createOptimization(userId, {
			title: "Handytarif wechseln",
			category: "utilities",
			currency: "EUR",
			currentMonthlyMinor: 3_500,
			alternativeMonthlyMinor: 1_000,
			oneTimeCostMinor: 0,
			status: "completed",
			completedAt: addMonths(today, -2),
			contractId: contract.id,
		});
		const row = (await listOptimizations(userId)).find(
			(candidate) => candidate.id === mission.id,
		);
		expect(row?.progress.phase).toBe("waiting");
		const csv = parseCsv(await exportOptimizationsCsv(userId));
		const header = csv[0];
		const line = csv.find((cells) => cells[0] === mission.id);
		expect(line?.[header.indexOf("bis_heute_gespart")]).toBe("0.00");
	});

	it("keeps a Remise item on the asset it is already linked to", async () => {
		const snapshot = (valuation: number): RemiseSnapshot => ({
			mode: "fortuna-sync",
			observedAt: `${today}T12:00:00.000Z`,
			currency: "EUR",
			items: [
				{
					slug: "2026-09-rolex-116034",
					sku: "REM-7",
					title: "Rolex Oyster Perpetual 36 116034 Full Set",
					lifecycle: "published",
					quantity: 1,
					valuation,
					valuationBasis: "target-price",
					acquisitionCost: 5_000,
					updatedAt: `${today}T12:00:00.000Z`,
				},
			],
		});
		const curated = await createAsset(userId, {
			name: "Rolex Oyster Perpetual 36 116034 Full Set",
			category: "watch",
			currency: "EUR",
			currentValueMinor: 600_000,
			section: "Uhren",
		});
		await applySnapshot(userId, snapshot(6_500));
		// The owner then records a second, similarly named watch by hand.
		const second = await createAsset(userId, {
			name: "Rolex Oyster Perpetual 36 116034 Full Set Zweituhr",
			category: "watch",
			currency: "EUR",
			currentValueMinor: 550_000,
		});
		await applySnapshot(userId, snapshot(6_600));
		const rows = await listAssets(userId);
		const linked = rows.filter(
			(row) => row.externalId === "2026-09-rolex-116034",
		);
		expect(linked.map((row) => row.id)).toEqual([curated.id]);
		expect(linked[0]?.currentValueMinor).toBe(660_000);
		const untouched = rows.find((row) => row.id === second.id);
		expect(untouched?.syncSource).toBeNull();
		expect(untouched?.currentValueMinor).toBe(550_000);
	});
});
