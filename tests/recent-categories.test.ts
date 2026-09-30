import { describe, expect, it } from "vitest";
import {
	forDirection,
	normaliseForSearch,
	pickerCategories,
	rememberRecent,
} from "@/lib/recent-categories";

describe("rememberRecent", () => {
	it("puts the newest first without duplicates and caps the list", () => {
		expect(rememberRecent([], "a")).toEqual(["a"]);
		expect(rememberRecent(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
		expect(rememberRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
	});
});

describe("pickerCategories", () => {
	const categories = [
		{ id: "food", name: "Lebensmittel", parentId: null },
		{ id: "fees", name: "Gebühren", parentId: null },
		{ id: "bank-fees", name: "Bankgebühren", parentId: "fees" },
		{ id: "rest", name: "Restaurants", parentId: null },
	];

	it("lists recent categories that still exist, newest first", () => {
		const view = pickerCategories(categories, ["rest", "deleted", "food"], "");
		expect(view.recent.map((c) => c.id)).toEqual(["rest", "food"]);
		expect(view.matches).toHaveLength(4);
	});

	it("searches without case or accents and ranks prefixes first", () => {
		const view = pickerCategories(categories, ["rest"], "gebuhr");
		expect(view.recent).toEqual([]);
		expect(view.matches.map((c) => c.id)).toEqual(["fees", "bank-fees"]);
		expect(view.exact).toBe(false);
		expect(pickerCategories(categories, [], "GEBÜHREN").exact).toBe(true);
	});

	it("puts the categories of the booking's direction first, keeping order", () => {
		const list = [
			{ id: "in", kind: "income" },
			{ id: "in-child", kind: "income" },
			{ id: "food", kind: "expense" },
			{ id: "move", kind: "transfer" },
		];
		expect(forDirection(list, true).map((c) => c.id)).toEqual([
			"food",
			"move",
			"in",
			"in-child",
		]);
		expect(forDirection(list, false).map((c) => c.id)).toEqual([
			"in",
			"in-child",
			"food",
			"move",
		]);
	});

	it("normalises ß and umlauts", () => {
		expect(normaliseForSearch(" Straße Ärger ")).toBe("strasse arger");
	});
});
