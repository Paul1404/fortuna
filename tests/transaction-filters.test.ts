import { describe, expect, it } from "vitest";
import {
	draftFromSearch,
	filterChips,
	periodPresets,
	searchFromDraft,
} from "@/lib/transaction-filters";

const names = {
	accounts: [{ id: "acc-1", name: "Girokonto" }],
	categories: [{ id: "cat-1", name: "Lebensmittel" }],
};

describe("filterChips", () => {
	it("shows nothing for the unfiltered list, and not the search text", () => {
		expect(filterChips({}, names)).toEqual([]);
		expect(filterChips({ q: "rewe", page: 3 }, names)).toEqual([]);
	});

	it("names each active filter and says how to remove it", () => {
		const chips = filterChips(
			{
				accountId: "acc-1",
				categoryId: "cat-1",
				from: "2026-09-01",
				to: "2026-09-30",
				direction: "outflow",
				transfers: "hide",
				sort: "amount_asc",
			},
			names,
		);
		expect(chips.map((chip) => chip.label)).toEqual([
			"Girokonto",
			"Lebensmittel",
			"01.09.2026 – 30.09.2026",
			"Ausgaben",
			"Ohne Umbuchungen",
			"Größte Ausgabe",
		]);
		expect(chips.find((chip) => chip.key === "period")?.clear).toEqual({
			from: undefined,
			to: undefined,
		});
	});

	it("does not list the default sort as a filter", () => {
		expect(filterChips({ sort: "date_desc" }, names)).toEqual([]);
	});

	it("prefers 'Ohne Kategorie' over a category and never shows an id", () => {
		expect(
			filterChips({ uncategorised: true, categoryId: "cat-1" }, names).map(
				(chip) => chip.label,
			),
		).toEqual(["Ohne Kategorie"]);
		expect(
			filterChips({ accountId: "gone", merchantId: "m-1" }, names).map(
				(chip) => chip.label,
			),
		).toEqual(["Konto", "Ein Händler"]);
		expect(
			filterChips(
				{ merchantId: "m-1", recurringPaymentId: "r-1" },
				{ ...names, merchant: "REWE", recurring: "Netflix" },
			).map((chip) => chip.label),
		).toEqual(["Händler: REWE", "Zahlung: Netflix"]);
	});

	it("labels an open-ended period", () => {
		expect(filterChips({ from: "2026-01-05" }, names)[0].label).toBe(
			"ab 05.01.2026",
		);
		expect(filterChips({ to: "2026-01-05" }, names)[0].label).toBe(
			"bis 05.01.2026",
		);
	});
});

describe("filter sheet round trip", () => {
	it("keeps every filter it edits and resets both pagers", () => {
		const search = {
			accountId: "acc-1",
			uncategorised: true,
			from: "2026-09-01",
			direction: "inflow" as const,
			page: 4,
			brokerPage: 2,
			q: "rewe",
		};
		const patch = searchFromDraft(draftFromSearch(search));
		expect(patch).toMatchObject({
			accountId: "acc-1",
			uncategorised: true,
			categoryId: undefined,
			from: "2026-09-01",
			direction: "inflow",
			page: undefined,
			brokerPage: undefined,
		});
		// The search text is not the sheet's to change.
		expect("q" in patch).toBe(false);
	});

	it("removes a filter the owner emptied", () => {
		const patch = searchFromDraft({ accountId: "", from: "" });
		expect(patch.accountId).toBeUndefined();
		expect(patch.from).toBeUndefined();
		expect("accountId" in patch).toBe(true);
	});

	it("drops the default sort from the URL", () => {
		expect(searchFromDraft({ sort: "date_desc" }).sort).toBeUndefined();
	});
});

describe("periodPresets", () => {
	it("offers this month, last month and the last 90 days", () => {
		expect(periodPresets("2026-03-15")).toEqual([
			{
				key: "this-month",
				label: "Dieser Monat",
				from: "2026-03-01",
				to: "2026-03-31",
			},
			{
				key: "last-month",
				label: "Letzter Monat",
				from: "2026-02-01",
				to: "2026-02-28",
			},
			{
				key: "90-days",
				label: "Letzte 90 Tage",
				from: "2025-12-16",
				to: "2026-03-15",
			},
		]);
	});

	it("crosses the year for January", () => {
		expect(periodPresets("2026-01-10")[1]).toMatchObject({
			from: "2025-12-01",
			to: "2025-12-31",
		});
	});
});
