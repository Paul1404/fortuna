import { describe, expect, it } from "vitest";
import { preferredSourceAccounts } from "@/domain/investment-source";

describe("investment source precedence", () => {
	it("uses live CLI portfolios instead of a row left by the removed CSV import", () => {
		const rows = [
			{
				id: "csv",
				provider: "scalable",
				method: "csv",
				cashBalanceMinor: null,
				portfolioValueMinor: null,
			},
			{
				id: "cli-a",
				provider: "scalable",
				method: "cli",
				cashBalanceMinor: 6900,
				portfolioValueMinor: 450000,
			},
			{
				id: "cli-b",
				provider: "scalable",
				method: "cli",
				cashBalanceMinor: 0,
				portfolioValueMinor: 10000,
			},
		];
		expect(
			preferredSourceAccounts(rows, (id) => id === "csv").map((r) => r.id),
		).toEqual(["cli-a", "cli-b"]);
	});
	it("still reads a leftover CSV row when no CLI row has a usable valuation", () => {
		const rows = [
			{
				id: "csv",
				provider: "scalable",
				method: "csv",
				cashBalanceMinor: null,
				portfolioValueMinor: null,
			},
			{
				id: "cli",
				provider: "scalable",
				method: "cli",
				cashBalanceMinor: null,
				portfolioValueMinor: null,
			},
		];
		expect(
			preferredSourceAccounts(rows, (id) => id === "csv").map((r) => r.id),
		).toEqual(["csv"]);
	});
	it("keeps quantity-only holdings visible when no source has a monetary value", () => {
		const rows = [
			{
				id: "cli",
				provider: "scalable",
				method: "cli",
				cashBalanceMinor: null,
				portfolioValueMinor: null,
			},
		];
		expect(
			preferredSourceAccounts(
				rows,
				() => false,
				() => true,
			).map((r) => r.id),
		).toEqual(["cli"]);
	});
});
