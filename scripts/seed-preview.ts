/** Isolated, fictional screenshot scenario. Never reads or modifies production. */
import { sql } from "drizzle-orm";
import { addDays, addMonths, endOfMonth, todayIso } from "@/domain/dates";
import { db, pool } from "@/server/db";
import { assertLocalBootstrapTarget } from "@/server/db/local-bootstrap";
import { createAccount, recordBalance } from "@/server/services/accounts";
import { addValuation, createAsset } from "@/server/services/assets";
import {
	ensureDefaultCategories,
	findCategoryBySlug,
} from "@/server/services/categories";
import {
	createLiability,
	recordLiabilityBalance,
} from "@/server/services/liabilities";
import { currentNetWorth } from "@/server/services/net-worth";
import { ensureOwnerFromEnv } from "@/server/services/owner";
import { runRecurringDetection } from "@/server/services/recurring";
import {
	type IncomingTransaction,
	insertTransactions,
} from "@/server/services/transactions";

async function main() {
	const target = process.env.DATABASE_URL ?? "";
	assertLocalBootstrapTarget(target, process.env.NODE_ENV);
	if (!new URL(target).pathname.startsWith("/fortuna_demo_"))
		throw new Error("Use an isolated fortuna_demo_* database.");
	const existing = await db.execute<{ occupied: boolean }>(sql`
		select exists(select 1 from accounts) or exists(select 1 from assets)
		or exists(select 1 from liabilities) or exists(select 1 from external_connections)
		or exists(select 1 from bank_connections) as occupied
	`);
	if (existing.rows[0]?.occupied)
		throw new Error("Refusing a nonempty demo database.");
	await ensureOwnerFromEnv();
	const owner = await db.query.user.findFirst();
	if (!owner || owner.email !== process.env.OWNER_EMAIL)
		throw new Error("Configure a fictional demo owner first.");
	const userId = owner.id;
	const today = todayIso();
	const start = addMonths(`${today.slice(0, 7)}-01`, -12);
	await ensureDefaultCategories(userId);
	const category = async (slug: string) =>
		(await findCategoryBySlug(userId, slug))?.id ?? null;
	const transfer = await category("transfers");
	const salary = await category("salary");
	const checking = await createAccount(userId, {
		name: "Girokonto",
		institution: "Musterbank",
		type: "current",
		currency: "EUR",
		openingBalanceMinor: 498_000,
		openingBalanceDate: start,
	});
	const savings = await createAccount(userId, {
		name: "Tagesgeld",
		institution: "Musterbank",
		type: "savings",
		currency: "EUR",
		openingBalanceMinor: 900_000,
		openingBalanceDate: start,
	});
	const investment = await createAccount(userId, {
		name: "Wertpapierdepot",
		institution: "Demo-Depot",
		type: "investment",
		currency: "EUR",
		openingBalanceMinor: 2_350_000,
		openingBalanceDate: start,
	});
	const cash = await createAccount(userId, {
		name: "Bargeld",
		type: "cash",
		currency: "EUR",
		openingBalanceMinor: 30_000,
		openingBalanceDate: start,
	});
	const card = await createAccount(userId, {
		name: "Kreditkarte",
		institution: "Musterbank",
		type: "credit_card",
		currency: "EUR",
		openingBalanceMinor: -60_000,
		openingBalanceDate: start,
	});
	const car = await createAsset(userId, {
		name: "Kompaktwagen",
		category: "vehicle",
		currency: "EUR",
		currentValueMinor: 1_750_000,
		valuationDate: start,
		acquisitionDate: start,
		acquisitionCostMinor: 1_750_000,
	});
	const equipment = await createAsset(userId, {
		name: "Computer und Kamera",
		category: "collectible",
		currency: "EUR",
		currentValueMinor: 150_000,
		valuationDate: start,
		acquisitionDate: start,
		acquisitionCostMinor: 150_000,
	});
	const loan = await createLiability(userId, {
		name: "Autofinanzierung",
		type: "vehicle_finance",
		currency: "EUR",
		originalAmountMinor: 650_000,
		currentBalanceMinor: 650_000,
		balanceDate: start,
		startDate: start,
		monthlyPaymentMinor: 12_500,
		interestRateBps: 0,
		linkedAssetId: car.id,
	});
	const expenses = [
		["Miete", "rent-mortgage", 95_000],
		["Lebensmittel", "groceries", 46_000],
		["Strom und Heizung", "utilities", 11_000],
		["Versicherung", "insurance", 8_000],
		["Internet und Telefon", "internet-phone", 4_000],
		["Mobilität", "public-transport", 16_000],
		["Essen gehen", "restaurants", 12_000],
		["Abonnements", "subscriptions", 4_500],
		["Freizeit", "leisure", 7_500],
	] as const;
	for (let i = 0; i < 12; i++) {
		const month = addMonths(start, i);
		const date = endOfMonth(month);
		const checkingRows: IncomingTransaction[] = [
			{
				bookingDate: addDays(month, 1),
				amountMinor: 340_000,
				currency: "EUR",
				description: "Gehalt Musterbetrieb",
				counterpartyName: "Musterbetrieb",
				categoryId: salary,
			},
		];
		for (const [index, [description, slug, amountMinor]] of expenses.entries())
			checkingRows.push({
				bookingDate: addDays(month, index + 2),
				amountMinor: -amountMinor,
				currency: "EUR",
				description,
				counterpartyName: description,
				categoryId: await category(slug),
			});
		checkingRows.push(
			{
				bookingDate: date,
				amountMinor: -50_000,
				currency: "EUR",
				description: "Umbuchung Tagesgeld",
				categoryId: transfer,
			},
			{
				bookingDate: date,
				amountMinor: -80_000,
				currency: "EUR",
				description: "Umbuchung Depot",
				categoryId: transfer,
			},
			{
				bookingDate: date,
				amountMinor: -12_500,
				currency: "EUR",
				description: "Darlehen: Tilgung",
				categoryId: transfer,
			},
		);
		await insertTransactions(userId, checking.id, checkingRows, {
			importSource: "preview",
		});
		await insertTransactions(
			userId,
			savings.id,
			[
				{
					bookingDate: date,
					amountMinor: 50_000,
					currency: "EUR",
					description: "Umbuchung Tagesgeld",
					categoryId: transfer,
				},
			],
			{ importSource: "preview" },
		);
		await insertTransactions(
			userId,
			investment.id,
			[
				{
					bookingDate: date,
					amountMinor: 80_000,
					currency: "EUR",
					description: "Umbuchung Depot",
					categoryId: transfer,
				},
			],
			{ importSource: "preview" },
		);
		await recordBalance(userId, {
			accountId: investment.id,
			date,
			balanceMinor: 2_350_000 + (i + 1) * 100_000,
			source: "manual",
		});
		await addValuation(userId, {
			assetId: car.id,
			date,
			valueMinor: 1_750_000 - (i + 1) * 25_000,
			source: "manual",
		});
		await addValuation(userId, {
			assetId: equipment.id,
			date,
			valueMinor: 150_000 - Math.round(((i + 1) * 40_000) / 12),
			source: "manual",
		});
		await recordLiabilityBalance(userId, {
			liabilityId: loan.id,
			date,
			balanceMinor: 650_000 - (i + 1) * 12_500,
		});
	}
	await recordBalance(userId, {
		accountId: cash.id,
		date: today,
		balanceMinor: 30_000,
		source: "manual",
	});
	await recordBalance(userId, {
		accountId: card.id,
		date: today,
		balanceMinor: -60_000,
		source: "manual",
	});
	await runRecurringDetection(userId);
	const snapshot = await currentNetWorth(userId);
	if (snapshot.netWorthMinor !== 6_500_000)
		throw new Error("Preview totals do not reconcile to EUR 65,000.");
	console.info(
		JSON.stringify({
			preview: "fictional",
			cashMinor: snapshot.cashMinor,
			investmentsMinor: snapshot.investmentsMinor,
			physicalMinor: snapshot.physicalMinor,
			liabilitiesMinor: snapshot.totalLiabilitiesMinor,
			netWorthMinor: snapshot.netWorthMinor,
		}),
	);
}

main()
	.catch(() => {
		console.error(
			"Preview seeding failed. Check the isolated demo target, empty register, and owner settings.",
		);
		process.exitCode = 1;
	})
	.finally(() => pool.end());
