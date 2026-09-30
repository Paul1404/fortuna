import { describe, expect, it } from "vitest";
import { applyRules, type Rule, ruleMatches } from "@/domain/rules";

const base: Rule = {
	id: "r1",
	priority: 100,
	isActive: true,
	descriptionContains: null,
	merchantContains: null,
	counterpartyIban: null,
	amountMinMinor: null,
	amountMaxMinor: null,
	accountId: null,
	direction: null,
	categoryId: "cat-tech",
	setMerchantName: null,
};
const subject = {
	accountId: "acc-1",
	description: "HETZNER Online GmbH Rechnung 2026-09",
	counterpartyName: "Hetzner Online GmbH",
	counterpartyIban: "DE12 3456 7890 1234 5678 90",
	amountMinor: -4990,
};

describe("categorisation rules", () => {
	it("matches description substrings case-insensitively", () => {
		expect(
			ruleMatches({ ...base, descriptionContains: "hetzner" }, subject),
		).toBe(true);
		expect(ruleMatches({ ...base, descriptionContains: "aws" }, subject)).toBe(
			false,
		);
	});
	it("a rule without conditions never matches", () => {
		expect(ruleMatches(base, subject)).toBe(false);
	});
	it("respects direction, amount range, account and IBAN", () => {
		expect(
			ruleMatches(
				{ ...base, direction: "outflow", descriptionContains: "hetzner" },
				subject,
			),
		).toBe(true);
		expect(
			ruleMatches(
				{ ...base, direction: "inflow", descriptionContains: "hetzner" },
				subject,
			),
		).toBe(false);
		expect(
			ruleMatches(
				{ ...base, amountMinMinor: 5000, descriptionContains: "hetzner" },
				subject,
			),
		).toBe(false);
		expect(
			ruleMatches(
				{
					...base,
					amountMinMinor: 1000,
					amountMaxMinor: 5000,
					descriptionContains: "hetzner",
				},
				subject,
			),
		).toBe(true);
		expect(
			ruleMatches(
				{ ...base, accountId: "acc-2", descriptionContains: "hetzner" },
				subject,
			),
		).toBe(false);
		expect(
			ruleMatches(
				{ ...base, counterpartyIban: "DE12345678901234567890" },
				subject,
			),
		).toBe(true);
	});
	it("first rule by priority wins and carries its effects", () => {
		const rules: Rule[] = [
			{
				...base,
				id: "later",
				priority: 200,
				descriptionContains: "hetzner",
				categoryId: "cat-other",
			},
			{
				...base,
				id: "first",
				priority: 10,
				descriptionContains: "hetzner",
				setMerchantName: "Hetzner",
			},
			{
				...base,
				id: "inactive",
				priority: 1,
				isActive: false,
				descriptionContains: "hetzner",
				categoryId: "cat-x",
			},
		];
		expect(applyRules(rules, subject)).toEqual({
			ruleId: "first",
			categoryId: "cat-tech",
			merchantName: "Hetzner",
		});
	});
});
