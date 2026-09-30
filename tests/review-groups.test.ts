import { describe, expect, it } from "vitest";
import {
	groupByMerchant,
	openPicks,
	seedCertainPicks,
	sharedPick,
} from "@/lib/review-groups";

type Row = {
	id: string;
	merchantName: string | null;
	description: string;
	amountMinor: number;
	suggestion?: { categoryId: string } | null;
};

const rows: Row[] = [
	{ id: "1", merchantName: "eBay", description: "x", amountMinor: -1000 },
	{ id: "2", merchantName: "EBAY", description: "y", amountMinor: -500 },
	{ id: "3", merchantName: "eBay", description: "z", amountMinor: 2000 },
	{ id: "4", merchantName: null, description: "Miete", amountMinor: -90000 },
];

describe("groupByMerchant", () => {
	it("groups by merchant and direction, largest group first", () => {
		const groups = groupByMerchant(rows);
		expect(groups.map((group) => group.rows.map((row) => row.id))).toEqual([
			["1", "2"],
			["3"],
			["4"],
		]);
		expect(groups[0].sumMinor).toBe(-1500);
		expect(groups[2].label).toBe("Miete");
	});
});

describe("sharedPick", () => {
	it("is the common category, or empty when rows differ", () => {
		expect(sharedPick(rows.slice(0, 2), { 1: "a", 2: "a" })).toBe("a");
		expect(sharedPick(rows.slice(0, 2), { 1: "a", 2: "b" })).toBe("");
		expect(sharedPick(rows.slice(0, 2), { 2: "a" })).toBe("");
	});
});

describe("openPicks", () => {
	it("never sends a pick for a booking that has left the review", () => {
		expect(openPicks({ 1: "a", 2: "b", 9: "c" }, new Set(["1", "2"]))).toEqual([
			{ transactionId: "1", categoryId: "a" },
			{ transactionId: "2", categoryId: "b" },
		]);
	});
});

describe("seedCertainPicks", () => {
	const certain = [
		{ id: "1", suggestion: { categoryId: "a" } },
		{ id: "2", suggestion: { categoryId: "b" } },
		{ id: "3", suggestion: null },
	];

	it("pre-ticks new certain proposals", () => {
		expect(seedCertainPicks(certain, {}, new Set())).toEqual({
			1: "a",
			2: "b",
		});
	});

	it("leaves a row the owner already saw, and their own choice, alone", () => {
		// Row 1 was unticked by the owner after it was shown.
		expect(seedCertainPicks(certain, { 2: "x" }, new Set(["1"]))).toBeNull();
	});
});
