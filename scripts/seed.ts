#!/usr/bin/env bun
/**
 * Realistic development dataset for Fortuna.
 *
 * Creates (or reuses) the owner account and fills it with ~14 months of
 * income, everyday spending, recurring payments, a credit card, investments,
 * a car, a watch, a mortgage and a car loan, including valuation history.
 * Idempotent per owner: running it again first wipes that user's data.
 *
 *   bun run db:seed
 */
import { eq } from "drizzle-orm";
import {
	addDays,
	addMonths,
	daysInMonth,
	endOfMonth,
	todayIso,
} from "@/domain/dates";
import { db, pool } from "@/server/db";
import {
	accounts,
	assets,
	bankConnections,
	categories,
	categorizationRules,
	contracts,
	copilotMemories,
	copilotThreads,
	externalConnections,
	financialObservations,
	financialProfiles,
	fxRates,
	importJobs,
	investmentPolicies,
	investmentSourceAccounts,
	liabilities,
	merchants,
	optimizations,
	providerCredentials,
	receivables,
	recurringPayments,
	transactions,
	userSettings,
} from "@/server/db/schema";
import { logger } from "@/server/logger";
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
import { ensureOwner } from "@/server/services/owner";
import { runRecurringDetection } from "@/server/services/recurring";
import { createRule } from "@/server/services/rules";
import { upsertFxRate } from "@/server/services/settings";
import {
	type IncomingTransaction,
	insertTransactions,
} from "@/server/services/transactions";

// Deterministic pseudo-random so the dataset is stable between runs.
let seed = 20260914;
function rand(): number {
	seed = (seed * 1103515245 + 12345) & 0x7fffffff;
	return seed / 0x7fffffff;
}
const between = (min: number, max: number) =>
	Math.round(min + rand() * (max - min));
const pick = <T>(list: readonly T[]): T =>
	list[Math.floor(rand() * list.length)];

const today = todayIso();
const START = addMonths(`${today.slice(0, 7)}-01`, -13); // 14 months incl. current

async function wipe(userId: string) {
	await db.delete(transactions).where(eq(transactions.userId, userId));
	await db.delete(importJobs).where(eq(importJobs.userId, userId));
	await db
		.delete(recurringPayments)
		.where(eq(recurringPayments.userId, userId));
	await db
		.delete(categorizationRules)
		.where(eq(categorizationRules.userId, userId));
	await db.delete(liabilities).where(eq(liabilities.userId, userId));
	await db.delete(assets).where(eq(assets.userId, userId));
	await db.delete(accounts).where(eq(accounts.userId, userId));
	await db.delete(merchants).where(eq(merchants.userId, userId));
	await db.delete(categories).where(eq(categories.userId, userId));
	// Everything else the owner can accumulate. Leaving any of it behind makes
	// the demo dataset contradict itself: stale receivables keep counting in net
	// worth, and contracts survive with their links cascaded to null.
	await db.delete(receivables).where(eq(receivables.userId, userId));
	await db.delete(contracts).where(eq(contracts.userId, userId));
	await db.delete(optimizations).where(eq(optimizations.userId, userId));
	await db
		.delete(investmentSourceAccounts)
		.where(eq(investmentSourceAccounts.userId, userId));
	await db.delete(bankConnections).where(eq(bankConnections.userId, userId));
	await db
		.delete(externalConnections)
		.where(eq(externalConnections.userId, userId));
	await db
		.delete(providerCredentials)
		.where(eq(providerCredentials.userId, userId));
	await db
		.delete(financialObservations)
		.where(eq(financialObservations.userId, userId));
	await db
		.delete(financialProfiles)
		.where(eq(financialProfiles.userId, userId));
	await db.delete(copilotMemories).where(eq(copilotMemories.userId, userId));
	await db.delete(copilotThreads).where(eq(copilotThreads.userId, userId));
	await db
		.delete(investmentPolicies)
		.where(eq(investmentPolicies.userId, userId));
	await db.delete(userSettings).where(eq(userSettings.userId, userId));
	await db.delete(fxRates);
}

async function main() {
	const { assertLocalBootstrapTarget } = await import(
		"../src/server/db/local-bootstrap"
	);
	assertLocalBootstrapTarget(
		process.env.DATABASE_URL ?? "",
		process.env.NODE_ENV,
	);
	const email = process.env.OWNER_EMAIL ?? "demo@fortuna.example.test";
	const password = process.env.OWNER_PASSWORD ?? "fortuna-dev-password-2026";
	const { userId } = await ensureOwner({
		email,
		password,
		name: process.env.OWNER_NAME ?? "Alex Beispiel",
	});
	await wipe(userId);
	await ensureDefaultCategories(userId);
	const cat = async (slug: string) =>
		(await findCategoryBySlug(userId, slug))?.id ?? null;

	// FX so a USD position and a CHF cash account convert into EUR.
	for (const [date, usd, chf, gbp] of [
		[addMonths(START, -1), 1.09, 0.95, 0.86],
		[addMonths(START, 3), 1.12, 0.94, 0.85],
		[addMonths(START, 7), 1.08, 0.96, 0.84],
		[addMonths(START, 11), 1.15, 0.93, 0.85],
	] as const) {
		await upsertFxRate({
			date,
			base: "EUR",
			quote: "USD",
			rate: usd,
			source: "seed",
		});
		await upsertFxRate({
			date,
			base: "EUR",
			quote: "CHF",
			rate: chf,
			source: "seed",
		});
		await upsertFxRate({
			date,
			base: "EUR",
			quote: "GBP",
			rate: gbp,
			source: "seed",
		});
	}

	// Accounts. Opening balances are dated at the start of history; imports
	// move them forward.
	const giro = await createAccount(userId, {
		name: "Girokonto",
		institution: "Musterbank",
		type: "current",
		currency: "EUR",
		iban: "DE89370400440532013000",
		openingBalanceMinor: 412_580,
		openingBalanceDate: START,
	});
	const tagesgeld = await createAccount(userId, {
		name: "Tagesgeld",
		institution: "ING",
		type: "savings",
		currency: "EUR",
		iban: "DE02500105170137075030",
		openingBalanceMinor: 3_250_000,
		openingBalanceDate: START,
	});
	const card = await createAccount(userId, {
		name: "Visa Card",
		institution: "DKB",
		type: "credit_card",
		currency: "EUR",
		openingBalanceMinor: -64_230,
		openingBalanceDate: START,
		creditLimitMinor: 500_000,
	});
	const cash = await createAccount(userId, {
		name: "Bargeld",
		type: "cash",
		currency: "EUR",
		openingBalanceMinor: 18_000,
		openingBalanceDate: START,
	});
	const chfCash = await createAccount(userId, {
		name: "CHF Reisekasse",
		type: "cash",
		currency: "CHF",
		openingBalanceMinor: 42_000,
		openingBalanceDate: START,
	});
	const broker = await createAccount(userId, {
		name: "Depot",
		institution: "Scalable Capital",
		type: "investment",
		currency: "EUR",
		openingBalanceMinor: 21_400,
		openingBalanceDate: START,
	});

	// Rules first so the import categorises deterministically.
	const rules: [
		string,
		string,
		string | null,
		{ direction?: "inflow" | "outflow"; merchant?: string },
	][] = [
		[
			"Salary",
			"gehalt",
			"salary",
			{ direction: "inflow", merchant: "Schwarz IT GmbH" },
		],
		["Rent", "miete", "rent-mortgage", { direction: "outflow" }],
		["Rewe", "rewe", "groceries", { merchant: "REWE" }],
		["Edeka", "edeka", "groceries", { merchant: "EDEKA" }],
		["Aldi", "aldi", "groceries", { merchant: "ALDI SÜD" }],
		["dm", "dm drogerie", "household", { merchant: "dm-drogerie markt" }],
		["Aral", "aral", "fuel", { merchant: "Aral" }],
		["Shell", "shell", "fuel", { merchant: "Shell" }],
		["DB", "deutsche bahn", "public-transport", { merchant: "Deutsche Bahn" }],
		["Vattenfall", "vattenfall", "utilities", { merchant: "Vattenfall" }],
		["Telekom", "telekom", "internet-phone", { merchant: "Telekom" }],
		["Allianz", "allianz", "insurance", { merchant: "Allianz" }],
		["HUK", "huk-coburg", "insurance", { merchant: "HUK-COBURG" }],
		[
			"TK",
			"techniker krankenkasse",
			"insurance",
			{ merchant: "Techniker Krankenkasse" },
		],
		["Spotify", "spotify", "streaming", { merchant: "Spotify" }],
		["Netflix", "netflix", "streaming", { merchant: "Netflix" }],
		["iCloud", "apple.com/bill", "software", { merchant: "Apple" }],
		["Hetzner", "hetzner", "hosting-domains", { merchant: "Hetzner" }],
		["GitHub", "github", "software", { merchant: "GitHub" }],
		["FAZ", "faz.net", "news-media", { merchant: "F.A.Z." }],
		["Fitness", "fitx", "fitness", { merchant: "FitX" }],
		["Apotheke", "apotheke", "pharmacy", {}],
		["Amazon", "amazon", "shopping", { merchant: "Amazon" }],
		["Zalando", "zalando", "clothing", { merchant: "Zalando" }],
		["Restaurants", "restaurant", "restaurants", {}],
		["Lieferando", "lieferando", "restaurants", { merchant: "Lieferando" }],
		[
			"Coffee",
			"coffee fellows",
			"coffee-snacks",
			{ merchant: "Coffee Fellows" },
		],
		["Bakery", "bäckerei", "coffee-snacks", {}],
		[
			"Car loan",
			"santander",
			"loan-repayment",
			{ merchant: "Santander Consumer Bank" },
		],
		[
			"Mortgage",
			"bausparkasse",
			"rent-mortgage",
			{ merchant: "LBS Bausparkasse" },
		],
		["Dividends", "dividende", "dividends-interest", { direction: "inflow" }],
		["Interest", "zinsen", "dividends-interest", { direction: "inflow" }],
		["Card payment", "kreditkartenabrechnung", "credit-card-payment", {}],
		["Savings", "sparplan", "investments", {}],
		["Tax refund", "finanzamt", "refunds", { direction: "inflow" }],
		["Rental income", "mieteinnahme", "other-income", { direction: "inflow" }],
		[
			"Donation",
			"ärzte ohne grenzen",
			"gifts-donations",
			{ merchant: "Ärzte ohne Grenzen" },
		],
		["Booking", "booking.com", "travel", { merchant: "Booking.com" }],
		["Autohaus", "autohaus", "car", {}],
	];
	let prio = 10;
	for (const [name, needle, slug, opts] of rules) {
		const categoryId = slug ? await cat(slug) : null;
		if (!categoryId) continue;
		await createRule(userId, {
			name,
			priority: prio++,
			isActive: true,
			descriptionContains: needle,
			merchantContains: null,
			counterpartyIban: null,
			amountMinMinor: null,
			amountMaxMinor: null,
			accountId: null,
			direction: opts.direction ?? null,
			categoryId,
			setMerchantName: opts.merchant ?? null,
		});
	}

	// Transactions month by month.
	const giroTx: IncomingTransaction[] = [];
	const cardTx: IncomingTransaction[] = [];
	const tagesgeldTx: IncomingTransaction[] = [];
	const brokerTx: IncomingTransaction[] = [];
	const cashTx: IncomingTransaction[] = [];
	const dayIn = (month: string, day: number) =>
		`${month}-${String(Math.min(day, daysInMonth(`${month}-01`))).padStart(2, "0")}`;
	let cursor = START;
	let monthIndex = 0;
	while (cursor <= today) {
		const m = cursor.slice(0, 7);
		const lastDay = endOfMonth(cursor);
		const inPast = (d: string) => d <= today;
		const push = (list: IncomingTransaction[], tx: IncomingTransaction) => {
			if (inPast(tx.bookingDate)) list.push(tx);
		};
		// Salary with a raise after month 8.
		const salary = monthIndex < 8 ? 585_000 : 612_500;
		push(giroTx, {
			bookingDate: dayIn(
				m,
				28 > Number(lastDay.slice(8)) ? Number(lastDay.slice(8)) : 28,
			),
			amountMinor: salary,
			description: `Gehalt ${m} Schwarz IT GmbH`,
			counterpartyName: "Schwarz IT GmbH",
			counterpartyIban: "DE12500105170648489890",
			externalId: `sal-${m}`,
		});
		push(giroTx, {
			bookingDate: dayIn(m, 1),
			amountMinor: -128_000,
			description: "Miete Wohnung Hauptstr. 14 Kaltmiete + NK",
			counterpartyName: "Hausverwaltung Bergmann",
			counterpartyIban: "DE44500105175407324931",
			externalId: `rent-${m}`,
		});
		push(giroTx, {
			bookingDate: dayIn(m, 3),
			amountMinor: -9_640,
			description: "Vattenfall Abschlag Strom",
			counterpartyName: "Vattenfall Europe Sales",
			externalId: `strom-${m}`,
		});
		push(giroTx, {
			bookingDate: dayIn(m, 5),
			amountMinor: -4_995,
			description: "Telekom Deutschland MagentaZuhause",
			counterpartyName: "Telekom Deutschland GmbH",
			externalId: `tel-${m}`,
		});
		push(giroTx, {
			bookingDate: dayIn(m, 15),
			amountMinor: -4_290,
			description: "Techniker Krankenkasse Zusatzbeitrag Wahltarif",
			counterpartyName: "Techniker Krankenkasse",
			externalId: `tk-${m}`,
		});
		push(giroTx, {
			bookingDate: dayIn(m, 3),
			amountMinor: 98_000,
			description: "Mieteinnahme Sanderau Wohnung 3.OG",
			counterpartyName: "Familie Hofmann",
			counterpartyIban: "DE75512108001245126199",
			externalId: `rentin-${m}`,
		});
		push(giroTx, {
			bookingDate: dayIn(m, 2),
			amountMinor: -61_240,
			description: "LBS Bausparkasse Darlehen 8812-4",
			counterpartyName: "LBS Bausparkasse",
			externalId: `lbs-${m}`,
		});
		push(giroTx, {
			bookingDate: dayIn(m, 10),
			amountMinor: -31_900,
			description: "Santander Consumer Bank Ratenkredit Kfz",
			counterpartyName: "Santander Consumer Bank",
			externalId: `sant-${m}`,
		});
		// Transfers: savings + ETF plan + credit-card settlement (both legs).
		const saveDate = dayIn(
			m,
			29 > Number(lastDay.slice(8)) ? Number(lastDay.slice(8)) : 29,
		);
		push(giroTx, {
			bookingDate: saveDate,
			amountMinor: -50_000,
			description: "Dauerauftrag Sparen Tagesgeld",
			counterpartyName: "Alex Beispiel",
			counterpartyIban: tagesgeld.iban,
			externalId: `save-${m}`,
		});
		push(tagesgeldTx, {
			bookingDate: saveDate,
			amountMinor: 50_000,
			description: "Dauerauftrag Sparen",
			counterpartyName: "Alex Beispiel",
			counterpartyIban: giro.iban,
			externalId: `save-in-${m}`,
		});
		const planDate = dayIn(m, 6);
		push(giroTx, {
			bookingDate: planDate,
			amountMinor: -40_000,
			description: "Sparplan Scalable Capital",
			counterpartyName: "Scalable Capital GmbH",
			externalId: `plan-${m}`,
		});
		push(brokerTx, {
			bookingDate: planDate,
			amountMinor: 40_000,
			description: "Sparplan Eingang",
			counterpartyName: "Alex Beispiel",
			counterpartyIban: giro.iban,
			externalId: `plan-in-${m}`,
		});
		push(brokerTx, {
			bookingDate: addDays(planDate, 1),
			amountMinor: -40_000,
			description: "Kauf Vanguard FTSE All-World Sparplan",
			counterpartyName: "Scalable Capital",
			externalId: `buy-${m}`,
			categoryId: await cat("investments"),
		});
		// Credit card usage then settlement.
		let cardTotal = 0;
		const cardMerchants = [
			"Amazon.de",
			"Zalando SE",
			"Spotify AB",
			"Netflix.com",
			"Apple.com/bill",
			"Deutsche Bahn Fernverkehr",
			"Restaurant Il Gusto",
			"Lieferando",
			"Booking.com",
			"Shell 1234 Würzburg",
		];
		const cardCount = between(8, 14);
		for (let i = 0; i < cardCount; i++) {
			const merchant = pick(cardMerchants);
			let amountMinor = -between(900, 9_800);
			if (merchant === "Spotify AB") amountMinor = -1_199;
			if (merchant === "Netflix.com") amountMinor = -1_799;
			if (merchant === "Apple.com/bill") amountMinor = -299;
			if (merchant === "Booking.com") amountMinor = -between(18_000, 42_000);
			if (merchant === "Deutsche Bahn Fernverkehr")
				amountMinor = -between(2_900, 14_900);
			const fixedDay =
				merchant === "Spotify AB"
					? 4
					: merchant === "Netflix.com"
						? 12
						: merchant === "Apple.com/bill"
							? 19
							: between(1, 28);
			const date = dayIn(m, fixedDay);
			if (!inPast(date)) continue;
			cardTotal += amountMinor;
			cardTx.push({
				bookingDate: date,
				amountMinor,
				description: `Kartenzahlung ${merchant} ${date.replace(/-/g, ".")}`,
				counterpartyName: merchant,
				externalId: `card-${m}-${i}`,
			});
		}
		// Ensure the subscriptions happen every month even if the random loop skipped them.
		for (const [merchant, amt, day] of [
			["Spotify AB", -1_199, 4],
			["Netflix.com", -1_799, 12],
			["Apple.com/bill", -299, 19],
		] as const) {
			const date = dayIn(m, day);
			if (
				inPast(date) &&
				!cardTx.some(
					(t) => t.bookingDate === date && t.counterpartyName === merchant,
				)
			) {
				cardTotal += amt;
				cardTx.push({
					bookingDate: date,
					amountMinor: amt,
					description: `Kartenzahlung ${merchant} ${date.replace(/-/g, ".")}`,
					counterpartyName: merchant,
					externalId: `card-${m}-${merchant}`,
				});
			}
		}
		const settleDate = addMonths(dayIn(m, 25), 0);
		if (inPast(settleDate) && cardTotal < 0) {
			push(giroTx, {
				bookingDate: settleDate,
				amountMinor: cardTotal,
				description: `Kreditkartenabrechnung DKB Visa ${m}`,
				counterpartyName: "DKB AG",
				externalId: `ccpay-${m}`,
			});
			push(cardTx, {
				bookingDate: settleDate,
				amountMinor: -cardTotal,
				description: "Ausgleich Kreditkartenabrechnung",
				counterpartyName: "Alex Beispiel",
				counterpartyIban: giro.iban,
				externalId: `ccpay-in-${m}`,
			});
		}
		// Everyday debit spending.
		const groceryCount = between(9, 14);
		for (let i = 0; i < groceryCount; i++) {
			const merchant = pick([
				"REWE Markt Würzburg",
				"EDEKA Center",
				"ALDI SÜD 4471",
				"dm drogerie markt",
				"Bäckerei Schmitt",
			]);
			const amt =
				merchant === "Bäckerei Schmitt"
					? -between(280, 1_240)
					: merchant === "dm drogerie markt"
						? -between(900, 4_800)
						: -between(1_800, 9_600);
			push(giroTx, {
				bookingDate: dayIn(m, between(1, 28)),
				amountMinor: amt,
				description: `Kartenzahlung ${merchant} ${String(between(10, 99))}`,
				counterpartyName: merchant,
				externalId: `groc-${m}-${i}`,
			});
		}
		for (let i = 0; i < between(2, 4); i++) {
			push(giroTx, {
				bookingDate: dayIn(m, between(2, 27)),
				amountMinor: -between(4_800, 8_900),
				description: `Aral Tankstelle ${String(between(100, 999))} Würzburg`,
				counterpartyName: "Aral AG",
				externalId: `fuel-${m}-${i}`,
			});
		}
		for (let i = 0; i < between(3, 6); i++) {
			push(giroTx, {
				bookingDate: dayIn(m, between(1, 28)),
				amountMinor: -between(380, 1_450),
				description: "Coffee Fellows Würzburg Hbf",
				counterpartyName: "Coffee Fellows",
				externalId: `cof-${m}-${i}`,
			});
		}
		for (let i = 0; i < between(1, 3); i++) {
			push(giroTx, {
				bookingDate: dayIn(m, between(1, 28)),
				amountMinor: -between(2_400, 7_800),
				description: pick([
					"Restaurant Alte Mainmühle",
					"Restaurant Backöfele",
					"Pizzeria Da Enzo",
				]),
				externalId: `rest-${m}-${i}`,
			});
		}
		if (rand() < 0.5)
			push(giroTx, {
				bookingDate: dayIn(m, between(3, 26)),
				amountMinor: -between(1_200, 4_600),
				description: "Hubertus-Apotheke Würzburg",
				counterpartyName: "Hubertus Apotheke",
				externalId: `apo-${m}`,
			});
		push(giroTx, {
			bookingDate: dayIn(m, 8),
			amountMinor: -2_990,
			description: "FitX Mitgliedsbeitrag",
			counterpartyName: "FitX GmbH",
			externalId: `fitx-${m}`,
		});
		push(giroTx, {
			bookingDate: dayIn(m, 9),
			amountMinor: -1_490,
			description: `Hetzner Online GmbH Rechnung R00${monthIndex}`,
			counterpartyName: "Hetzner Online GmbH",
			externalId: `hetz-${m}`,
		});
		push(giroTx, {
			bookingDate: dayIn(m, 14),
			amountMinor: -400,
			description: "GitHub Inc. Pro plan",
			counterpartyName: "GitHub",
			externalId: `gh-${m}`,
		});
		push(giroTx, {
			bookingDate: dayIn(m, 20),
			amountMinor: -2_490,
			description: "FAZ.NET Digital-Abo",
			counterpartyName: "Frankfurter Allgemeine Zeitung GmbH",
			externalId: `faz-${m}`,
		});
		push(giroTx, {
			bookingDate: dayIn(m, 17),
			amountMinor: -2_500,
			description: "Ärzte ohne Grenzen Spende",
			counterpartyName: "Ärzte ohne Grenzen e.V.",
			externalId: `don-${m}`,
		});
		// Cash withdrawals -> cash account
		const wd = dayIn(m, between(5, 20));
		push(giroTx, {
			bookingDate: wd,
			amountMinor: -15_000,
			description: "Bargeldauszahlung Sparkasse GA 4711",
			counterpartyName: "Sparkasse",
			externalId: `atm-${m}`,
		});
		push(cashTx, {
			bookingDate: wd,
			amountMinor: 15_000,
			description: "Bargeldauszahlung",
			externalId: `atm-in-${m}`,
		});
		for (let i = 0; i < between(3, 6); i++)
			push(cashTx, {
				bookingDate: dayIn(m, between(6, 28)),
				amountMinor: -between(300, 3_200),
				description: pick(["Wochenmarkt", "Trinkgeld", "Kiosk", "Parkautomat"]),
				externalId: `cash-${m}-${i}`,
			});
		// Quarterly / yearly items.
		const monthNum = Number(m.slice(5, 7));
		if (monthNum % 3 === 1)
			push(giroTx, {
				bookingDate: dayIn(m, 4),
				amountMinor: -18_450,
				description: "HUK-COBURG Kfz-Versicherung Quartal",
				counterpartyName: "HUK-COBURG",
				externalId: `huk-${m}`,
			});
		if (monthNum === 2)
			push(giroTx, {
				bookingDate: dayIn(m, 2),
				amountMinor: -38_900,
				description: "Allianz Hausrat + Haftpflicht Jahresbeitrag",
				counterpartyName: "Allianz Versicherungs-AG",
				externalId: `allianz-${m}`,
			});
		if (monthNum === 7)
			push(giroTx, {
				bookingDate: dayIn(m, 21),
				amountMinor: 124_300,
				description: "Finanzamt Würzburg Einkommensteuererstattung",
				counterpartyName: "Finanzamt Würzburg",
				externalId: `tax-${m}`,
			});
		if (monthNum === 12)
			push(giroTx, {
				bookingDate: dayIn(m, 15),
				amountMinor: 230_000,
				description: "Gehalt Weihnachtsgeld Schwarz IT GmbH",
				counterpartyName: "Schwarz IT GmbH",
				externalId: `bonus-${m}`,
			});
		if (monthNum % 3 === 0)
			push(tagesgeldTx, {
				bookingDate: lastDay,
				amountMinor: between(9_800, 14_200),
				description: "Zinsen Tagesgeld",
				counterpartyName: "ING",
				externalId: `int-${m}`,
			});
		if (monthNum % 3 === 0)
			push(brokerTx, {
				bookingDate: dayIn(m, 27),
				amountMinor: between(6_000, 9_800),
				description: "Dividende Vanguard FTSE All-World",
				counterpartyName: "Vanguard",
				externalId: `div-${m}`,
			});
		// Occasional bigger purchases.
		if (monthIndex === 3)
			push(giroTx, {
				bookingDate: dayIn(m, 11),
				amountMinor: -129_900,
				description: "Amazon.de Bestellung 302-4416 MacBook Zubehör",
				counterpartyName: "Amazon EU S.a.r.L.",
				externalId: `big-${m}`,
			});
		if (monthIndex === 9)
			push(giroTx, {
				bookingDate: dayIn(m, 16),
				amountMinor: -84_000,
				description: "Autohaus Keller Inspektion + Reifen",
				counterpartyName: "Autohaus Keller GmbH",
				externalId: `car-${m}`,
				categoryId: await cat("car"),
			});
		cursor = addMonths(cursor, 1);
		monthIndex += 1;
	}
	// A known future item for the forecast.
	giroTx.push({
		bookingDate: addDays(today, 12),
		amountMinor: -45_000,
		description: "Zahnarzt Rechnung Dr. Weber",
		counterpartyName: "Dr. Weber Zahnarztpraxis",
		status: "pending",
		externalId: "pending-dentist",
		categoryId: await cat("health"),
	});

	await db.transaction(async (tx) => {
		await insertTransactions(
			userId,
			giro.id,
			giroTx,
			{ importSource: "seed" },
			tx,
		);
		await insertTransactions(
			userId,
			tagesgeld.id,
			tagesgeldTx,
			{ importSource: "seed" },
			tx,
		);
		await insertTransactions(
			userId,
			card.id,
			cardTx,
			{ importSource: "seed" },
			tx,
		);
		await insertTransactions(
			userId,
			broker.id,
			brokerTx,
			{ importSource: "seed" },
			tx,
		);
		await insertTransactions(
			userId,
			cash.id,
			cashTx,
			{ importSource: "seed" },
			tx,
		);
	});
	// A couple of observed balances to anchor history.
	await recordBalance(userId, {
		accountId: chfCash.id,
		date: addMonths(today, -6),
		balanceMinor: 31_500,
		source: "manual",
	});
	await recordBalance(userId, {
		accountId: chfCash.id,
		date: today,
		balanceMinor: 27_800,
		source: "manual",
	});

	// Assets with valuation history
	const car = await createAsset(userId, {
		name: "BMW 330e Touring",
		category: "vehicle",
		currency: "EUR",
		acquisitionDate: addMonths(START, -14),
		acquisitionCostMinor: 4_690_000,
		currentValueMinor: 4_100_000,
		valuationDate: START,
		valuationSource: "market",
		reference: "WBA5R71090FK12345",
		section: "Cars",
		notes: "Leasing-Übernahme, Scheckheft gepflegt.",
	});
	for (const [offset, value] of [
		[3, 3_920_000],
		[6, 3_760_000],
		[9, 3_640_000],
		[12, 3_510_000],
	] as const) {
		await addValuation(userId, {
			assetId: car.id,
			date: addMonths(START, offset),
			valueMinor: value,
			source: "market",
			notes: "Schwacke/mobile.de Vergleich",
		});
	}
	const watch = await createAsset(userId, {
		name: "Rolex Submariner 126610LN",
		category: "watch",
		currency: "EUR",
		acquisitionDate: addMonths(START, -30),
		acquisitionCostMinor: 920_000,
		currentValueMinor: 1_180_000,
		valuationDate: START,
		valuationSource: "market",
		reference: "126610LN",
		section: "Watches",
		notes: "Full set, Box und Papiere.",
	});
	for (const [offset, value] of [
		[4, 1_240_000],
		[8, 1_160_000],
		[12, 1_210_000],
	] as const) {
		await addValuation(userId, {
			assetId: watch.id,
			date: addMonths(START, offset),
			valueMinor: value,
			source: "market",
			notes: "Chrono24 Median",
		});
	}
	const flat = await createAsset(userId, {
		name: "Eigentumswohnung Sanderau",
		category: "real_estate",
		currency: "EUR",
		acquisitionDate: addMonths(START, -40),
		acquisitionCostMinor: 28_500_000,
		currentValueMinor: 31_200_000,
		valuationDate: START,
		valuationSource: "appraisal",
		notes: "2,5 Zimmer, 68 m², vermietet.",
	});
	await addValuation(userId, {
		assetId: flat.id,
		date: addMonths(START, 6),
		valueMinor: 31_800_000,
		source: "appraisal",
		notes: "Gutachten Sparkasse",
	});
	await addValuation(userId, {
		assetId: flat.id,
		date: addMonths(START, 12),
		valueMinor: 32_100_000,
		source: "manual",
		notes: "Immoscout Preisatlas",
	});
	await createAsset(userId, {
		name: "Goldmünzen (10 × 1 oz Krügerrand)",
		category: "precious_metal",
		currency: "EUR",
		acquisitionDate: addMonths(START, -50),
		acquisitionCostMinor: 1_620_000,
		currentValueMinor: 2_340_000,
		valuationDate: today,
		valuationSource: "market",
	});
	const cameraDate = addMonths(START, 2);
	const camera = await createAsset(userId, {
		name: "Leica M11",
		category: "collectible",
		currency: "EUR",
		acquisitionDate: cameraDate,
		acquisitionCostMinor: 895_000,
		currentValueMinor: 895_000,
		valuationDate: cameraDate,
		valuationSource: "purchase",
	});
	await addValuation(userId, {
		assetId: camera.id,
		date: addMonths(START, 12),
		valueMinor: 780_000,
		source: "market",
	});

	// Liabilities with balance history
	const mortgage = await createLiability(userId, {
		name: "Immobiliendarlehen LBS",
		type: "mortgage",
		lender: "LBS Bausparkasse",
		currency: "EUR",
		originalAmountMinor: 22_000_000,
		currentBalanceMinor: 17_640_000,
		balanceDate: START,
		interestRateBps: 189,
		monthlyPaymentMinor: 61_240,
		startDate: addMonths(START, -40),
		endDate: addMonths(START, 300),
		linkedAssetId: flat.id,
	});
	const carLoan = await createLiability(userId, {
		name: "Autokredit Santander",
		type: "vehicle_finance",
		lender: "Santander Consumer Bank",
		currency: "EUR",
		originalAmountMinor: 1_500_000,
		currentBalanceMinor: 1_120_000,
		balanceDate: START,
		interestRateBps: 449,
		monthlyPaymentMinor: 31_900,
		startDate: addMonths(START, -14),
		endDate: addMonths(START, 34),
		linkedAssetId: car.id,
	});
	await createLiability(userId, {
		name: "DKB Visa Konditionen",
		type: "credit_card",
		lender: "DKB",
		currency: "EUR",
		currentBalanceMinor: 0,
		interestRateBps: 1_390,
		linkedAccountId: card.id,
		notes: "Balance comes from the Visa Card account.",
	});
	let mortgageBalance = 17_640_000;
	let carBalance = 1_120_000;
	for (let i = 1; i <= 14; i++) {
		const date = i === 14 ? today : addMonths(START, i);
		mortgageBalance -= 61_240 - Math.round((mortgageBalance * 0.0189) / 12);
		carBalance -= 31_900 - Math.round((carBalance * 0.0449) / 12);
		await recordLiabilityBalance(userId, {
			liabilityId: mortgage.id,
			date,
			balanceMinor: mortgageBalance,
		});
		await recordLiabilityBalance(userId, {
			liabilityId: carLoan.id,
			date,
			balanceMinor: Math.max(0, carBalance),
		});
	}

	const detection = await runRecurringDetection(userId);
	logger.info("Seed complete", {
		event: "seed.completed",
		userId,
		email,
		transactions:
			giroTx.length +
			tagesgeldTx.length +
			cardTx.length +
			brokerTx.length +
			cashTx.length,
		recurringCreated: detection.created,
	});
	console.log(
		"\nSign in with the configured local demo owner. Passwords are not printed.\n",
	);
}

main()
	.catch((err) => {
		logger.error("Seed failed", { event: "seed.failed", err });
		process.exitCode = 1;
	})
	.finally(() => pool.end());
