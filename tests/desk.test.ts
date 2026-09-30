import { describe, expect, it } from "vitest";
import { MIN_ORDER_MINOR, MIN_TRANSFER_MINOR } from "@/domain/capital-advice";
import {
	composeDeskTasks,
	type DeskInputs,
	filedSummary,
	liquidityStructure,
	MAX_VALUE_TASKS,
	orderTasks,
	transferSource,
} from "@/domain/desk";
import type { DeskTask } from "@/domain/desk-contract";
import { FxTable } from "@/domain/fx";
import { formatMoney } from "@/domain/money";
import { computeNetWorth, type NetWorthInput } from "@/domain/net-worth";

const eur = (minor: number) => formatMoney(minor, "EUR");

const fx = new FxTable([
	{ date: "2026-01-01", base: "EUR", quote: "USD", rate: 1.25 },
]);

function balanceSheet(): NetWorthInput {
	return {
		date: "2026-09-26",
		baseCurrency: "EUR",
		fx,
		accounts: [
			{
				id: "giro",
				name: "Girokonto",
				type: "current",
				currency: "EUR",
				balanceMinor: 1_200_000,
				includeInNetWorth: true,
			},
			{
				id: "tagesgeld",
				name: "Tagesgeld",
				type: "savings",
				currency: "EUR",
				balanceMinor: 2_000_000,
				includeInNetWorth: true,
			},
			{
				id: "paypal",
				name: "PayPal",
				type: "wallet",
				currency: "EUR",
				balanceMinor: 5_000,
				includeInNetWorth: true,
			},
			{
				id: "usd",
				name: "Dollar-Bargeld",
				type: "cash",
				currency: "USD",
				balanceMinor: 12_500,
				includeInNetWorth: true,
			},
			{
				id: "card",
				name: "Kreditkarte",
				type: "credit_card",
				currency: "EUR",
				balanceMinor: -80_000,
				includeInNetWorth: true,
			},
			{
				id: "mpe",
				name: "MPE Private Equity",
				type: "investment",
				currency: "EUR",
				balanceMinor: 3_000_000,
				includeInNetWorth: true,
			},
			{
				id: "insurance",
				name: "Rentenversicherung",
				type: "investment",
				currency: "EUR",
				balanceMinor: 1_500_000,
				includeInNetWorth: true,
			},
			{
				id: "mirrored",
				name: "Scalable (manuell)",
				type: "investment",
				currency: "EUR",
				balanceMinor: 9_999_999,
				includeInNetWorth: true,
			},
			{
				id: "hidden",
				name: "Ausgeblendet",
				type: "current",
				currency: "EUR",
				balanceMinor: 999_999,
				includeInNetWorth: false,
			},
		],
		positions: [],
		providerAccounts: [
			{
				id: "scalable",
				provider: "Scalable Capital",
				method: "cli",
				linkedAccountId: "mirrored",
				currency: "EUR",
				cashBalanceMinor: 400_000,
				cashValuationAt: "2026-09-26T10:00:00Z",
				portfolioValueMinor: 5_000_000,
				portfolioValuationAt: "2026-09-26T10:00:00Z",
				holdings: [],
			},
		],
		assets: [
			{
				id: "car",
				name: "Auto",
				category: "vehicle",
				currency: "EUR",
				valueMinor: 1_800_000,
				acquisitionCostMinor: null,
			},
			{
				id: "watch-1",
				name: "Uhr aus der Remise",
				category: "inventory",
				currency: "EUR",
				valueMinor: 250_000,
				acquisitionCostMinor: null,
			},
			{
				id: "stake",
				name: "Beteiligung GmbH",
				category: "private_investment",
				currency: "EUR",
				valueMinor: 700_000,
				acquisitionCostMinor: null,
			},
		],
		receivables: [
			{
				id: "loan-to-max",
				name: "Darlehen",
				debtorName: "Max",
				currency: "EUR",
				balanceMinor: 300_000,
			},
		],
		liabilities: [
			{
				id: "card-liability",
				name: "Kreditkarte",
				type: "credit_card",
				currency: "EUR",
				balanceMinor: 80_000,
				linkedAccountId: "card",
			},
		],
	};
}

const contracts = [
	{
		id: "c-insurance",
		name: "Rentenversicherung Vertrag",
		accountId: "insurance",
		status: "active" as const,
		startDate: "2015-01-01",
		endDate: "2040-12-31",
		cancellationDate: null,
		renewalDate: null,
		noticePeriodDays: null,
	},
];

function structure() {
	return liquidityStructure({
		netWorth: balanceSheet(),
		contracts,
		assetSyncSources: new Map([["watch-1", "remise"]]),
		receivableDueDates: new Map([["loan-to-max", "2027-03-01"]]),
	});
}

describe("liquidity structure", () => {
	it("reconciles with the asset side of net worth", () => {
		const result = structure();
		const sum = Object.values(result.totals).reduce((a, b) => a + b, 0);
		expect(sum).toBe(computeNetWorth(balanceSheet()).totalAssetsMinor);
		expect(result.items.reduce((a, item) => a + item.valueMinor, 0)).toBe(sum);
	});

	it("puts bank accounts in now, never nets the card debt against them", () => {
		const now = structure().items.filter((item) => item.tier === "now");
		expect(now.map((item) => item.id).sort()).toEqual([
			"account:giro",
			"account:paypal",
			"account:tagesgeld",
			"account:usd",
		]);
		// The dollar cash is converted exactly as net worth converts it.
		expect(now.find((item) => item.id === "account:usd")?.valueMinor).toBe(
			10_000,
		);
		expect(structure().totals.now).toBe(1_200_000 + 2_000_000 + 5_000 + 10_000);
	});

	it("counts broker cash and listed securities as days", () => {
		const days = structure().items.filter((item) => item.tier === "days");
		expect(days.map((item) => [item.id, item.valueMinor])).toEqual([
			["depot:scalable", 5_000_000],
			["depot-cash:scalable", 400_000],
		]);
		// The manual account mirrored by the broker snapshot is not counted twice.
		expect(
			structure().items.some((item) => item.id === "account:mirrored"),
		).toBe(false);
	});

	it("locks investment accounts until their contract ends", () => {
		const items = structure().items;
		const insurance = items.find((item) => item.id === "account:insurance");
		expect(insurance).toMatchObject({
			tier: "locked",
			availableFrom: "2040-12-31",
		});
		expect(insurance?.note).toContain("31.12.2040");
		const mpe = items.find((item) => item.id === "account:mpe");
		expect(mpe).toMatchObject({ tier: "locked", availableFrom: null });
		expect(mpe?.note).toBe("Kein Vertrag mit Laufzeitende verknüpft");
	});

	it("says an ended contract is over rather than inventing a date", () => {
		const result = liquidityStructure({
			netWorth: balanceSheet(),
			contracts: [{ ...contracts[0], endDate: "2026-06-30" }],
			assetSyncSources: new Map(),
			receivableDueDates: new Map(),
		});
		const insurance = result.items.find(
			(item) => item.id === "account:insurance",
		);
		expect(insurance?.availableFrom).toBe("2026-06-30");
		expect(insurance?.note).toContain("beendet");
	});

	it("waits for receivables and private stakes, sells things", () => {
		const items = structure().items;
		expect(
			items.find((item) => item.id === "receivable:loan-to-max"),
		).toMatchObject({ tier: "locked", availableFrom: "2027-03-01" });
		expect(items.find((item) => item.id === "asset:stake")?.tier).toBe(
			"locked",
		);
		const sellable = items.filter((item) => item.tier === "sellable");
		expect(sellable.map((item) => item.id)).toEqual([
			"asset:car",
			"asset:watch-1",
		]);
		expect(sellable[1].note).toBe("Im Remise-Bestand");
	});

	it("orders tiers from now to sellable", () => {
		const tiers = structure().items.map((item) => item.tier);
		const order = ["now", "days", "locked", "sellable"];
		expect(
			[...tiers].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
		).toEqual(tiers);
	});
});

describe("transfer source", () => {
	it("is the base-currency bank account holding the most", () => {
		expect(transferSource(balanceSheet().accounts, "EUR")).toEqual({
			id: "tagesgeld",
			name: "Tagesgeld",
			balanceMinor: 2_000_000,
		});
	});
});

function inputs(overrides: Partial<DeskInputs> = {}): DeskInputs {
	return {
		today: "2026-09-26",
		baseCurrency: "EUR",
		bookings: { open: 0, withProposal: 0, amountMinor: 0 },
		observations: [],
		freeMoney: null,
		quality: [],
		...overrides,
	};
}

describe("desk tasks", () => {
	it("is empty when there is nothing to do", () => {
		expect(composeDeskTasks(inputs())).toEqual([]);
	});

	it("asks for the bookings the owner still has to decide", () => {
		const [task] = composeDeskTasks(
			inputs({ bookings: { open: 7, withProposal: 3, amountMinor: 31_240 } }),
		);
		expect(task).toMatchObject({
			key: "review_bookings",
			severity: "review",
			title: "7 Buchungen ohne Kategorie",
			amountMinor: 31_240,
			action: { kind: "review_bookings" },
		});
		expect(task.detail).toBe(
			`3 mit Vorschlag, 4 ohne Anhaltspunkt, zusammen ${eur(31_240)}.`,
		);
	});

	it("names free money once, with both amounts, from the minimums up", () => {
		expect(
			composeDeskTasks(
				inputs({
					freeMoney: {
						bankMinor: MIN_TRANSFER_MINOR - 1,
						brokerMinor: MIN_ORDER_MINOR - 1,
					},
				}),
			),
		).toEqual([]);
		const [task, ...rest] = composeDeskTasks(
			inputs({ freeMoney: { bankMinor: 431_300, brokerMinor: 10_700 } }),
		);
		expect(rest).toEqual([]);
		expect(task).toMatchObject({
			key: "invest_money",
			title: "Freies Geld",
			amountMinor: 442_000,
			action: { kind: "invest_money", bankMinor: 431_300, brokerMinor: 10_700 },
		});
		expect(task.detail).toBe(
			`${eur(431_300)} auf dem Konto, ${eur(10_700)} im Depot.`,
		);
	});

	it("leaves bank money below a transfer's worth out of the figure", () => {
		const [task] = composeDeskTasks(
			inputs({
				freeMoney: { bankMinor: MIN_TRANSFER_MINOR - 1, brokerMinor: 60_000 },
			}),
		);
		expect(task.detail).toBe(`${eur(60_000)} im Depot.`);
		expect(task.action).toEqual({
			kind: "invest_money",
			bankMinor: 0,
			brokerMinor: 60_000,
		});
	});

	it("names stale values but leaves those an observation already raised", () => {
		const tasks = composeDeskTasks(
			inputs({
				observations: [
					{
						id: "obs-1",
						key: "stale_valuation:asset:car",
						severity: "notable",
						title: "Wert prüfen: Auto",
						explanation: "Die letzte Bewertung ist 90 Tage alt.",
						impactMinor: null,
						currency: null,
					},
				],
				quality: [
					{
						id: "car",
						kind: "asset",
						name: "Auto",
						state: "stale",
						ageDays: 90,
					},
					{
						id: "loan",
						kind: "liability",
						name: "Kredit",
						state: "missing",
						ageDays: null,
					},
					{
						id: "giro",
						kind: "account",
						name: "Giro",
						state: "current",
						ageDays: 1,
					},
				],
			}),
		);
		expect(tasks.map((task) => task.key)).toEqual([
			"observation:stale_valuation:asset:car",
			"update_value:liability:loan",
		]);
		expect(tasks[1]).toMatchObject({
			title: "Kredit aktualisieren",
			detail: "Kein Datum hinterlegt.",
			action: {
				kind: "update_value",
				href: "/debts?tab=liabilities&highlight=loan",
			},
		});
		// The stale-value observation links straight into the value update.
		expect(tasks[0].action).toEqual({
			kind: "observation",
			observationId: expect.any(String),
			href: "/assets/car?update=1",
		});
	});

	it(`puts at most ${MAX_VALUE_TASKS} stale values on the desk`, () => {
		const quality = Array.from({ length: 9 }, (_, index) => ({
			id: `asset-${index}`,
			kind: "asset" as const,
			name: `Wert ${index}`,
			state: "stale",
			ageDays: 40 + index,
		}));
		const tasks = composeDeskTasks(inputs({ quality }));
		expect(tasks).toHaveLength(MAX_VALUE_TASKS);
		// Oldest first.
		expect(tasks[0].key).toBe("update_value:asset:asset-8");
	});

	it("maps observation severity and counts only base-currency impact", () => {
		const tasks = composeDeskTasks(
			inputs({
				observations: [
					{
						id: "a",
						key: "liquidity:reserve",
						severity: "urgent",
						title: "Liquiditätsreserve unterschritten",
						explanation: "…",
						impactMinor: 50_000,
						currency: "EUR",
					},
					{
						id: "b",
						key: "price_increase:x",
						severity: "notable",
						title: "Teurer",
						explanation: "…",
						impactMinor: 1_000,
						currency: "USD",
					},
				],
			}),
		);
		expect(tasks.map((task) => [task.severity, task.amountMinor])).toEqual([
			["urgent", 50_000],
			["info", null],
		]);
		expect(tasks[0].action).toEqual({
			kind: "observation",
			observationId: "a",
		});
	});

	it("orders by severity, then money at stake, then as composed", () => {
		const task = (
			key: string,
			severity: DeskTask["severity"],
			amountMinor: number | null,
		): DeskTask => ({
			key,
			severity,
			title: key,
			detail: "",
			amountMinor,
			action: { kind: "open", href: "/" },
		});
		const ordered = orderTasks([
			task("c", "info", 900_000),
			task("b", "review", null),
			task("a", "review", 10_000),
			task("z", "urgent", null),
			task("d", "review", null),
		]).map((row) => row.key);
		expect(ordered).toEqual(["z", "a", "b", "d", "c"]);
	});

	it("keeps keys stable across identical inputs", () => {
		const input = inputs({
			bookings: { open: 2, withProposal: 1, amountMinor: 100 },
			freeMoney: { bankMinor: 0, brokerMinor: 60_000 },
		});
		expect(composeDeskTasks(input).map((task) => task.key)).toEqual(
			composeDeskTasks(input).map((task) => task.key),
		);
	});
});

describe("filed summary", () => {
	it("groups by merchant and category, at most five lines", () => {
		const rows = [
			...Array.from({ length: 4 }, () => ({
				merchant: "Rewe",
				categoryName: "Lebensmittel",
			})),
			{ merchant: "Aral", categoryName: "Auto" },
			{ merchant: "Netflix", categoryName: "Abos" },
		];
		expect(filedSummary(rows)).toEqual([
			"Rewe → Lebensmittel (4)",
			"Aral → Auto (1)",
			"Netflix → Abos (1)",
		]);
		const many = Array.from({ length: 8 }, (_, index) => ({
			merchant: `Händler ${index}`,
			categoryName: "Sonstiges",
		}));
		const summary = filedSummary(many);
		expect(summary).toHaveLength(5);
		expect(summary[4]).toBe("4 weitere Buchungen");
	});
});
