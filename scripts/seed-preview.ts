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
	detectAndLinkTransfers,
	type IncomingTransaction,
	insertTransactions,
} from "@/server/services/transactions";

/** Fixed seed: the same fictional year on every run. */
function mulberry32(seed: number) {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}

/** Paid on the same day for the same amount every month. */
// Never on the 1st: a booking on the opening date does not move the balance.
const FIXED = [
	["Hausverwaltung Lindenhof", "Miete", "rent-mortgage", 95_000, 2],
	["Stadtwerke Musterstadt", "Strom Abschlag", "utilities", 7_800, 2],
	["Netzwerk Nord", "Internetanschluss", "internet-phone", 3_999, 4],
	["Mobilfunk Eins", "Mobilfunkvertrag", "internet-phone", 1_499, 9],
	["Musterversicherung", "Haftpflicht und Hausrat", "insurance", 2_140, 1],
	["Verkehrsverbund Musterstadt", "Monatskarte", "public-transport", 5_800, 1],
	["Streamwelt", "Abo", "streaming", 1_399, 13],
	["Tonstrom", "Abo", "streaming", 1_099, 17],
	["Studio Aktiv", "Mitgliedsbeitrag", "fitness", 2_990, 2],
] as const;

/** Bought as needed: how often a month, and between which amounts. */
const VARIABLE = [
	["Frischemarkt", "groceries", 3, 4, 3_800, 9_400],
	["Bio-Kontor", "groceries", 1, 2, 2_200, 5_600],
	["Bäckerei Kornblume", "coffee-snacks", 2, 4, 350, 1_250],
	["Trattoria Sole", "restaurants", 1, 2, 2_800, 6_400],
	["Café Morgenrot", "restaurants", 1, 2, 900, 2_400],
	["Tankstelle Süd", "fuel", 1, 2, 4_500, 7_600],
	["Kino Lichtspiel", "leisure", 0, 2, 1_100, 2_800],
	["Buchhandlung Seitenweise", "leisure", 0, 1, 1_400, 4_200],
	["Kaufhaus Mitte", "clothing", 0, 1, 3_900, 14_900],
] as const;

/** Month-end depot values: a year that rises with two setbacks. */
const DEPOT_PATH = [
	2_465_000, 2_590_000, 2_640_000, 2_795_000, 2_730_000, 2_880_000, 3_045_000,
	3_110_000, 3_060_000, 3_270_000, 3_420_000, 3_550_000,
] as const;

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
	// The year is generated first, so the opening balance can be the one that
	// lands the current account on EUR 4,200 whatever was spent on the way.
	const random = mulberry32(65_000);
	const between = (low: number, high: number) =>
		low + Math.floor(random() * (high - low + 1));
	const checkingMonths: IncomingTransaction[][] = [];
	for (let i = 0; i < 12; i++) {
		const month = addMonths(start, i);
		const date = endOfMonth(month);
		const rows: IncomingTransaction[] = [
			{
				bookingDate: addDays(month, 1),
				// A raise in the second half of the year.
				amountMinor: i < 7 ? 340_000 : 352_000,
				currency: "EUR",
				description: "Gehalt",
				counterpartyName: "Musterbetrieb GmbH",
				categoryId: salary,
			},
		];
		for (const [name, description, slug, amountMinor, day] of FIXED)
			rows.push({
				bookingDate: addDays(month, day),
				amountMinor: -amountMinor,
				currency: "EUR",
				description,
				counterpartyName: name,
				categoryId: await category(slug),
			});
		for (const [name, slug, least, most, low, high] of VARIABLE) {
			const days = new Set<number>();
			const visits = between(least, most);
			while (days.size < visits) days.add(between(2, 26));
			for (const day of days)
				rows.push({
					bookingDate: addDays(month, day),
					amountMinor: -between(low, high),
					currency: "EUR",
					description: "Kartenzahlung",
					counterpartyName: name,
					categoryId: await category(slug),
				});
		}
		// What happens once a year.
		const calendarMonth = month.slice(5, 7);
		if (calendarMonth === "01")
			rows.push({
				bookingDate: addDays(month, 6),
				amountMinor: -48_600,
				currency: "EUR",
				description: "Kfz-Versicherung Jahresbeitrag",
				counterpartyName: "Autoversicherung Direkt",
				categoryId: await category("insurance"),
			});
		if (calendarMonth === "05")
			rows.push({
				bookingDate: addDays(month, 11),
				amountMinor: 61_200,
				currency: "EUR",
				description: "Einkommensteuer Erstattung",
				counterpartyName: "Finanzamt Musterstadt",
				categoryId: await category("refunds"),
			});
		if (calendarMonth === "07")
			rows.push({
				bookingDate: addDays(month, 8),
				amountMinor: -118_000,
				currency: "EUR",
				description: "Sommerurlaub",
				counterpartyName: "Reisebüro Fernweh",
				categoryId: await category("travel"),
			});
		if (calendarMonth === "12")
			rows.push({
				bookingDate: addDays(month, 14),
				amountMinor: -24_000,
				currency: "EUR",
				description: "Geschenke",
				counterpartyName: "Kaufhaus Mitte",
				categoryId: await category("gifts-donations"),
			});
		// Left unfiled in the latest month, so the desk has something to show.
		if (i === 11)
			rows.push(
				{
					bookingDate: addDays(month, 27),
					amountMinor: -3_490,
					currency: "EUR",
					description: "Kartenzahlung",
					counterpartyName: "Eisenwaren Hoffmann",
				},
				{
					bookingDate: addDays(month, 28),
					amountMinor: -1_850,
					currency: "EUR",
					description: "Kartenzahlung",
					counterpartyName: "Blumen am Markt",
				},
			);
		// Both legs of a transfer stay unfiled: pairing files them, and it leaves
		// alone anything that looks like the owner's own decision.
		rows.push(
			{
				bookingDate: date,
				amountMinor: -50_000,
				currency: "EUR",
				description: "Umbuchung Tagesgeld",
			},
			{
				bookingDate: date,
				amountMinor: -80_000,
				currency: "EUR",
				description: "Umbuchung Depot",
			},
			{
				bookingDate: date,
				amountMinor: -12_500,
				currency: "EUR",
				description: "Darlehen: Tilgung",
				categoryId: transfer,
			},
		);
		checkingMonths.push(rows);
	}
	const booked = checkingMonths
		.flat()
		.reduce((sum, row) => sum + row.amountMinor, 0);
	const checking = await createAccount(userId, {
		name: "Girokonto",
		institution: "Musterbank",
		type: "current",
		currency: "EUR",
		openingBalanceMinor: 420_000 - booked,
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
	for (let i = 0; i < 12; i++) {
		const month = addMonths(start, i);
		const date = endOfMonth(month);
		const checkingRows = checkingMonths[i] ?? [];
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
				},
			],
			{ importSource: "preview" },
		);
		await recordBalance(userId, {
			accountId: investment.id,
			date,
			balanceMinor: DEPOT_PATH[i] ?? 3_550_000,
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
	await detectAndLinkTransfers(userId);
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
