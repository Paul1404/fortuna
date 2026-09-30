import * as v from "valibot";
import { describe, expect, it } from "vitest";
import {
	INVESTMENT_RULES_MAX,
	INVESTMENT_RULES_PLACEHOLDER,
	investmentRulesProblem,
	normaliseInvestmentRules,
	normaliseSellReason,
	SELL_REASON_MAX,
	sellReasonProblem,
} from "@/domain/investment-rules";
import {
	BrokerOrderPreview,
	FinancialProfileUpdate,
	InvestmentTargetsUpdate,
} from "@/lib/schemas";

describe("investment rules", () => {
	it("stores the owner's text with tidy edges and nothing for blank", () => {
		expect(
			normaliseInvestmentRules(
				"  \r\nIch verkaufe nur, wenn …  \r\n\r\n\r\n\r\nIm Crash: nichts.  \n ",
			),
		).toBe("Ich verkaufe nur, wenn …\n\nIm Crash: nichts.");
		expect(normaliseInvestmentRules("   \n  ")).toBeNull();
		expect(normaliseInvestmentRules(null)).toBeNull();
	});

	it("bounds the note at 2,000 characters", () => {
		expect(investmentRulesProblem("a".repeat(INVESTMENT_RULES_MAX))).toBeNull();
		expect(
			investmentRulesProblem("a".repeat(INVESTMENT_RULES_MAX + 1)),
		).toMatch(/höchstens/);
		// Surrounding whitespace does not count against the owner.
		expect(
			investmentRulesProblem(`  ${"a".repeat(INVESTMENT_RULES_MAX)}\n\n`),
		).toBeNull();
	});

	it("offers examples as a placeholder of a few sentences", () => {
		const lines = INVESTMENT_RULES_PLACEHOLDER.split("\n");
		expect(lines.length).toBeGreaterThanOrEqual(2);
		expect(lines.length).toBeLessThanOrEqual(3);
		expect(INVESTMENT_RULES_PLACEHOLDER).toContain("Ich verkaufe nur, wenn");
	});

	it("is editable in the session form but not through the Copilot's targets", () => {
		expect(
			v.parse(FinancialProfileUpdate, { investmentRules: "Nie im Crash." }),
		).toEqual({ investmentRules: "Nie im Crash." });
		expect(
			v.safeParse(FinancialProfileUpdate, {
				investmentRules: "a".repeat(INVESTMENT_RULES_MAX + 1),
			}).success,
		).toBe(false);
		expect(
			v.parse(InvestmentTargetsUpdate, { investmentRules: "x" }),
		).not.toHaveProperty("investmentRules");
	});
});

describe("Warum jetzt?", () => {
	it("needs one real sentence, not a shrug", () => {
		expect(sellReasonProblem("")).not.toBeNull();
		expect(sellReasonProblem("   weil    ")).not.toBeNull();
		expect(sellReasonProblem("Brauche es")).toBeNull();
		expect(
			sellReasonProblem("Ich brauche das Geld im Frühjahr für die Wohnung."),
		).toBeNull();
		expect(sellReasonProblem("a".repeat(SELL_REASON_MAX + 1))).toMatch(
			/höchstens/,
		);
	});

	it("keeps the owner's words on one line", () => {
		expect(normaliseSellReason("  Rebalancing\n  nach   Plan ")).toBe(
			"Rebalancing nach Plan",
		);
	});

	it("is required for a sale and not asked for a buy", () => {
		const sell = { side: "sell", isin: "LU2903252349", shares: 2 };
		expect(v.safeParse(BrokerOrderPreview, sell).success).toBe(false);
		expect(
			v.safeParse(BrokerOrderPreview, { ...sell, reason: "kurz" }).success,
		).toBe(false);
		expect(
			v.safeParse(BrokerOrderPreview, {
				...sell,
				reason: "Rebalancing: Aktien 6 Punkte über Ziel.",
			}).success,
		).toBe(true);
		expect(
			v.safeParse(BrokerOrderPreview, {
				side: "buy",
				isin: "LU2903252349",
				amountMinor: 50_000,
			}).success,
		).toBe(true);
	});
});
