import { describe, expect, it } from "vitest";
import {
	type CategoryInfo,
	monthlyCashflow,
	rollingAverage,
	savingsRate,
	spendingByCategory,
} from "@/domain/cashflow";

const categories = new Map<string, CategoryInfo>([
	["income", { id: "income", kind: "income", parentId: null, name: "Income" }],
	[
		"groceries",
		{ id: "groceries", kind: "expense", parentId: null, name: "Groceries" },
	],
	[
		"coffee",
		{ id: "coffee", kind: "expense", parentId: "restaurants", name: "Coffee" },
	],
	[
		"restaurants",
		{ id: "restaurants", kind: "expense", parentId: null, name: "Restaurants" },
	],
	[
		"transfer",
		{ id: "transfer", kind: "transfer", parentId: null, name: "Transfers" },
	],
]);

const txs = [
	{ bookingDate: "2026-08-01", amountMinor: 400000, categoryId: "income" },
	{ bookingDate: "2026-08-03", amountMinor: -6000, categoryId: "groceries" },
	{ bookingDate: "2026-08-04", amountMinor: -400, categoryId: "coffee" },
	{
		bookingDate: "2026-08-05",
		amountMinor: -100000,
		categoryId: null,
		transferGroupId: "t1",
	},
	{
		bookingDate: "2026-08-05",
		amountMinor: 100000,
		categoryId: null,
		transferGroupId: "t1",
	},
	{ bookingDate: "2026-08-06", amountMinor: -20000, categoryId: "transfer" },
	{
		bookingDate: "2026-08-07",
		amountMinor: -999,
		categoryId: "groceries",
		status: "pending" as const,
	},
	{ bookingDate: "2026-09-01", amountMinor: 400000, categoryId: "income" },
	{ bookingDate: "2026-09-02", amountMinor: -8000, categoryId: "groceries" },
];

describe("cashflow", () => {
	it("excludes internal transfers, transfer categories and pending rows", () => {
		const series = monthlyCashflow(txs, categories, "2026-08-01", "2026-09-30");
		expect(series).toEqual([
			{
				month: "2026-08",
				incomeMinor: 400000,
				expenseMinor: 6400,
				netMinor: 393600,
				transactionCount: 3,
			},
			{
				month: "2026-09",
				incomeMinor: 400000,
				expenseMinor: 8000,
				netMinor: 392000,
				transactionCount: 2,
			},
		]);
	});
	it("rolls children into parents for category spend", () => {
		const spend = spendingByCategory(
			txs,
			categories,
			"2026-08-01",
			"2026-08-31",
		);
		expect(spend.map((s) => [s.name, s.amountMinor])).toEqual([
			["Groceries", 6000],
			["Restaurants", 400],
		]);
		expect(spend[0].share).toBeCloseTo(6000 / 6400);
	});
	it("rolling averages and savings rate", () => {
		const series = monthlyCashflow(txs, categories, "2026-08-01", "2026-09-30");
		const avg = rollingAverage(series, 2);
		expect(avg[1].expenseMinor).toBe(7200);
		expect(savingsRate(400000, 100000)).toBeCloseTo(0.75);
		expect(savingsRate(0, 100)).toBeNull();
	});
});
