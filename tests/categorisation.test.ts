import { describe, expect, it } from "vitest";
import {
	type CategorisedPrior,
	historyConsensus,
	parseConsultation,
	proposeCategories,
	readConsultation,
	suggestionKey,
	type UncategorisedTransaction,
} from "@/domain/categorisation";
import type { Rule } from "@/domain/rules";

const transaction = (
	over: Partial<UncategorisedTransaction> = {},
): UncategorisedTransaction => ({
	id: "t1",
	accountId: "a1",
	description: "KIOSK AM BAHNHOF",
	merchantName: "Kiosk Am Bahnhof",
	counterpartyName: null,
	counterpartyIban: null,
	amountMinor: -450,
	recurringPaymentId: null,
	...over,
});

const prior = (over: Partial<CategorisedPrior> = {}): CategorisedPrior => ({
	merchantName: "Kiosk Am Bahnhof",
	description: "KIOSK AM BAHNHOF",
	counterpartyName: null,
	amountMinor: -450,
	categoryId: "lebensmittel",
	categorySource: "import",
	...over,
});

const empty = {
	rules: [] as Rule[],
	merchantDefaults: new Map<string, string>(),
	recurringCategories: new Map<string, string>(),
	priorsByKey: new Map<string, CategorisedPrior[]>(),
	categoryNames: new Map([["lebensmittel", "Lebensmittel"]]),
	ruleNames: new Map<string, string>(),
};

describe("category proposals", () => {
	it("proposes nothing when there is no evidence at all", () => {
		expect(
			proposeCategories({ ...empty, transactions: [transaction()] })
				.suggestions,
		).toEqual([]);
	});

	it("treats a run the owner set by hand as certain", () => {
		const key = suggestionKey(
			"Kiosk Am Bahnhof",
			null,
			"KIOSK AM BAHNHOF",
			-450,
		);
		const { suggestions } = proposeCategories({
			...empty,
			transactions: [transaction()],
			priorsByKey: new Map([
				[
					key as string,
					[
						prior({ categorySource: "manual" }),
						prior({ categorySource: "import" }),
					],
				],
			]),
		});
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]).toMatchObject({
			categoryId: "lebensmittel",
			source: "history",
			certain: true,
		});
		expect(suggestions[0].evidence).toContain("Alle 2");
	});

	it("needs a longer run when the owner never confirmed one by hand", () => {
		const key = suggestionKey(
			"Kiosk Am Bahnhof",
			null,
			"KIOSK AM BAHNHOF",
			-450,
		);
		const withPriors = (n: number) =>
			proposeCategories({
				...empty,
				transactions: [transaction()],
				priorsByKey: new Map([
					[key as string, Array.from({ length: n }, () => prior())],
				]),
			}).suggestions[0];
		expect(withPriors(2).certain).toBe(false);
		expect(withPriors(4).certain).toBe(true);
	});

	it("proposes but never pre-ticks a merchant the owner has split", () => {
		const key = suggestionKey(
			"Kiosk Am Bahnhof",
			null,
			"KIOSK AM BAHNHOF",
			-450,
		);
		const suggestion = proposeCategories({
			...empty,
			transactions: [transaction()],
			priorsByKey: new Map([
				[key as string, [prior(), prior(), prior({ categoryId: "freizeit" })]],
			]),
		}).suggestions[0];
		expect(suggestion.certain).toBe(false);
		expect(suggestion.evidence).toContain("die übrigen nicht");
	});

	it("keeps a refund out of the purchase category", () => {
		const outKey = suggestionKey(
			"Kiosk Am Bahnhof",
			null,
			"KIOSK AM BAHNHOF",
			-450,
		);
		const refund = transaction({ id: "t2", amountMinor: 450 });
		expect(
			proposeCategories({
				...empty,
				transactions: [refund],
				priorsByKey: new Map([
					[outKey as string, [prior({ categorySource: "manual" }), prior()]],
				]),
			}).suggestions,
		).toEqual([]);
	});

	it("puts the owner's own rule ahead of everything else", () => {
		const rule: Rule = {
			id: "r1",
			priority: 50,
			isActive: true,
			descriptionContains: "KIOSK",
			merchantContains: null,
			counterpartyIban: null,
			amountMinMinor: null,
			amountMaxMinor: null,
			accountId: null,
			direction: null,
			categoryId: "snacks",
			setMerchantName: null,
		};
		const suggestion = proposeCategories({
			...empty,
			transactions: [transaction()],
			rules: [rule],
			ruleNames: new Map([["r1", "Kiosk"]]),
			merchantDefaults: new Map([["kiosk am bahnhof", "lebensmittel"]]),
		}).suggestions[0];
		expect(suggestion).toMatchObject({
			categoryId: "snacks",
			source: "rule",
			certain: true,
		});
		expect(suggestion.evidence).toContain("Kiosk");
	});

	it("uses the merchant default the app never read before", () => {
		expect(
			proposeCategories({
				...empty,
				transactions: [transaction()],
				merchantDefaults: new Map([["kiosk am bahnhof", "lebensmittel"]]),
			}).suggestions[0],
		).toMatchObject({ source: "merchant_default", certain: true });
	});
});

describe("history consensus", () => {
	it("reports the majority and how much of it was manual", () => {
		expect(
			historyConsensus([
				prior({ categorySource: "manual" }),
				prior(),
				prior({ categoryId: "freizeit" }),
			]),
		).toEqual({
			categoryId: "lebensmittel",
			count: 3,
			share: 2 / 3,
			manualCount: 1,
		});
	});

	it("has nothing to say about a merchant with no history", () => {
		expect(historyConsensus([])).toBeNull();
	});
});

describe("notes", () => {
	it("says a merchant is inconsistent rather than unknown", () => {
		const key = suggestionKey(
			"Parkautomat",
			null,
			"PARKAUTOMAT INNENSTADT",
			-250,
		);
		const split = proposeCategories({
			...empty,
			transactions: [
				transaction({
					merchantName: "Parkautomat",
					description: "PARKAUTOMAT INNENSTADT",
					amountMinor: -250,
				}),
			],
			priorsByKey: new Map([
				[
					key as string,
					[
						prior({ categoryId: "mobilitaet", categorySource: "manual" }),
						prior({ categoryId: "freizeit", categorySource: "manual" }),
					],
				],
			]),
		});
		// A coin flip is not a suggestion, but it is worth explaining.
		expect(split.suggestions).toEqual([]);
		expect(split.notes.get("t1")).toContain("unterschiedlich zugeordnet");
	});

	it("stays quiet about a merchant it has genuinely never seen", () => {
		const fresh = proposeCategories({
			...empty,
			transactions: [transaction()],
		});
		expect(fresh.notes.size).toBe(0);
	});
});

describe("reading Hr. Körner's answer", () => {
	const asked = {
		merchants: [
			"Pizzeria DA Enzo",
			"SV Untereuerheim 1945 EV",
			"Manfred Deppert",
		],
		categories: [
			{ id: "rest", name: "Restaurants" },
			{ id: "mob", name: "Mobilität" },
		],
	};

	it("finds the JSON inside a fenced block and surrounding prose", () => {
		const answer = [
			"Basst scho, des meiste is eindeutig:",
			"```json",
			'{"nachricht":"Drei hab ich zugeordnet.","zuordnungen":[{"haendler":"Pizzeria DA Enzo","kategorie":"Restaurants","begruendung":"Eine Pizzeria ist ein Lokal"}],"rueckfragen":[]}',
			"```",
		].join("\n");
		const parsed = parseConsultation(answer, asked);
		expect(parsed.message).toBe("Drei hab ich zugeordnet.");
		expect(parsed.assignments).toEqual([
			{
				merchant: "Pizzeria DA Enzo",
				categoryId: "rest",
				categoryName: "Restaurants",
				isNew: false,
				reason: "Eine Pizzeria ist ein Lokal",
			},
		]);
	});

	it("keeps a category the owner does not have, marked as new", () => {
		const answer =
			'{"nachricht":"","zuordnungen":[{"haendler":"SV Untereuerheim 1945 EV","kategorie":"Vereinsbeitrag","begruendung":"Ein Sportverein"}]}';
		const parsed = parseConsultation(answer, asked);
		// Proposing one is the point; it simply carries no id until it exists.
		expect(parsed.assignments[0]).toMatchObject({
			categoryId: null,
			categoryName: "Vereinsbeitrag",
			isNew: true,
		});
	});

	it("discards a merchant that was never asked about", () => {
		const answer =
			'{"zuordnungen":[{"haendler":"Ganz woanders","kategorie":"Restaurants"}]}';
		expect(parseConsultation(answer, asked).assignments).toEqual([]);
	});

	it("carries questions with their quick answers", () => {
		const answer =
			'{"nachricht":"Bei einem bin i mir ned sicher.","zuordnungen":[],"rueckfragen":[{"haendler":"Manfred Deppert","frage":"Drei Zahlungen an Manfred Deppert — privat oder ein Handwerker?","antworten":["Privat","Handwerker","Miete"]}]}';
		const parsed = parseConsultation(answer, asked);
		expect(parsed.questions).toEqual([
			{
				merchant: "Manfred Deppert",
				question:
					"Drei Zahlungen an Manfred Deppert — privat oder ein Handwerker?",
				options: ["Privat", "Handwerker", "Miete"],
			},
		]);
	});

	it("never both files and asks about the same merchant", () => {
		const answer =
			'{"zuordnungen":[{"haendler":"Manfred Deppert","kategorie":"Restaurants"}],"rueckfragen":[{"haendler":"Manfred Deppert","frage":"Doch unklar?","antworten":[]}]}';
		const parsed = parseConsultation(answer, asked);
		expect(parsed.assignments).toHaveLength(1);
		expect(parsed.questions).toEqual([]);
	});

	it("bounds what it will show and strips control characters", () => {
		const answer = JSON.stringify({
			nachricht: "a".repeat(500),
			zuordnungen: [
				{
					haendler: "Pizzeria DA Enzo",
					kategorie: `Rest\naurants${"x".repeat(80)}`,
					begruendung: "b".repeat(500),
				},
			],
			rueckfragen: [
				{
					haendler: "Manfred Deppert",
					frage: "Was ist das?",
					antworten: ["a", "b", "c", "d", "e", "f"],
				},
			],
		});
		const parsed = parseConsultation(answer, asked);
		expect(parsed.message).toHaveLength(300);
		expect(parsed.assignments[0].categoryName).toHaveLength(40);
		expect(parsed.assignments[0].categoryName).not.toContain("\n");
		expect(parsed.assignments[0].reason).toHaveLength(300);
		expect(parsed.questions[0].options).toHaveLength(4);
	});

	it("survives an answer that is not JSON at all", () => {
		expect(parseConsultation("Des woaß i ned.", asked).assignments).toEqual([]);
		expect(parseConsultation("{kaputt", asked).questions).toEqual([]);
		expect(parseConsultation("", asked).message).toBe("");
	});

	it("matches names case-insensitively and keeps the owner's spelling", () => {
		const answer =
			'{"zuordnungen":[{"haendler":"pizzeria da enzo","kategorie":"restaurants"}]}';
		const parsed = parseConsultation(answer, asked);
		expect(parsed.assignments[0].merchant).toBe("Pizzeria DA Enzo");
		expect(parsed.assignments[0].categoryName).toBe("Restaurants");
	});
});

describe("working through to the end", () => {
	const asked = {
		merchants: ["eBay S.a.r.l.", "Jonas Straub", "ALEX BEISPIEL"],
		categories: [{ id: "rest", name: "Restaurants" }],
	};

	it("takes several questions in one answer, not just one", () => {
		// Capping follow-ups at one question is why a list of 21 merchants
		// stalled after the first exchange.
		const answer = JSON.stringify({
			nachricht: "Bei dreien bin i mir ned sicher.",
			zuordnungen: [],
			rueckfragen: [
				{ haendler: "eBay S.a.r.l.", frage: "Wofür?", antworten: ["Privat"] },
				{ haendler: "Jonas Straub", frage: "Wofür?", antworten: ["Privat"] },
				{ haendler: "ALEX BEISPIEL", frage: "Wofür?", antworten: ["Privat"] },
			],
		});
		expect(parseConsultation(answer, asked).questions).toHaveLength(3);
	});

	it("handles a merchant either way, never both", () => {
		const answer = JSON.stringify({
			zuordnungen: [{ haendler: "eBay S.a.r.l.", kategorie: "Restaurants" }],
			rueckfragen: [
				{ haendler: "eBay S.a.r.l.", frage: "Doch unklar?", antworten: [] },
				{ haendler: "Jonas Straub", frage: "Wofür?", antworten: ["Privat"] },
			],
		});
		const parsed = parseConsultation(answer, asked);
		expect(parsed.assignments.map((row) => row.merchant)).toEqual([
			"eBay S.a.r.l.",
		]);
		expect(parsed.questions.map((row) => row.merchant)).toEqual([
			"Jonas Straub",
		]);
	});
});

describe("readConsultation", () => {
	it("separates filed bookings from proposed new categories", () => {
		const result = readConsultation([
			{
				transactionId: "t1",
				categoryId: "cat-food",
				categoryName: "Lebensmittel",
				reason: "Supermarkt",
			},
			{
				transactionId: "t2",
				categoryId: null,
				categoryName: "Verein",
				reason: "Mitgliedsbeitrag",
			},
			{
				transactionId: "t3",
				categoryId: null,
				categoryName: "Verein",
				reason: "Mitgliedsbeitrag",
			},
		]);
		expect(result.filled).toEqual({ t1: "cat-food" });
		expect(result.reasons).toEqual({
			t1: "Supermarkt",
			t2: "Mitgliedsbeitrag",
			t3: "Mitgliedsbeitrag",
		});
		expect(result.proposals).toEqual([
			{ name: "Verein", forRows: ["t2", "t3"], reason: "Mitgliedsbeitrag" },
		]);
	});

	it("returns nothing for an empty answer", () => {
		expect(readConsultation([])).toEqual({
			filled: {},
			reasons: {},
			proposals: [],
		});
	});
});
