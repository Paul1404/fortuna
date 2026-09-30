import { describe, expect, it } from "vitest";
import {
	describeSplit,
	MIN_ORDER_MINOR,
	type PlanInput,
	planInvestment,
} from "@/domain/capital-advice";

function input(overrides: Partial<PlanInput> = {}): PlanInput {
	return {
		bankCashMinor: 1_431_300,
		brokerCashMinor: 10_700,
		reserveMinor: 1_000_000,
		forecastLowestMinor: null,
		forecastLowestDate: null,
		holdings: [
			{
				isin: "IE00B6R52259",
				name: "MSCI ACWI",
				bucket: "equity",
				valueMinor: 4_000_000,
			},
		],
		targets: { equity: 9000, bonds: 0, cash: 1000, other: 0 },
		horizonMonths: 240,
		snapshotAgeDays: 0,
		transferLimitMinor: 2_000_000,
		...overrides,
	};
}

describe("Anlegen", () => {
	it("transfers the bank money above the reserve and buys it with the depot cash", () => {
		const plan = planInvestment(input());
		expect(plan.bankFreeMinor).toBe(431_300);
		expect(plan.brokerFreeMinor).toBe(10_700);
		expect(plan.transferMinor).toBe(431_300);
		expect(plan.buys).toEqual([
			{
				key: "buy:IE00B6R52259",
				isin: "IE00B6R52259",
				name: "MSCI ACWI",
				bucket: "equity",
				amountMinor: 442_000,
			},
		]);
		expect(plan.findings).toEqual([]);
	});

	it("counts the reserve towards the cash share instead of on top of it", () => {
		// 10 % of 54 420 € is 5 442 €, less than the 10 000 € reserve.
		const plan = planInvestment(input());
		expect(plan.cashTargetMinor).toBe(544_200);
		expect(plan.keepMinor).toBe(1_000_000);
		// A cash share above the reserve keeps that much liquid instead.
		const cashHeavy = planInvestment(
			input({ targets: { equity: 7000, bonds: 0, cash: 3000, other: 0 } }),
		);
		expect(cashHeavy.keepMinor).toBe(1_632_600);
		expect(cashHeavy.bankFreeMinor).toBe(0);
		expect(cashHeavy.transferMinor).toBe(0);
	});

	it("covers a short reserve with depot cash before buying anything", () => {
		const plan = planInvestment(
			input({
				bankCashMinor: 400_000,
				brokerCashMinor: 500_000,
				reserveMinor: 600_000,
			}),
		);
		expect(plan.bankFreeMinor).toBe(0);
		// 400 000 at the bank + 200 000 of the depot cash make up the reserve.
		expect(plan.brokerFreeMinor).toBe(300_000);
		expect(plan.transferMinor).toBe(0);
		expect(plan.buys.map((buy) => buy.amountMinor)).toEqual([300_000]);
	});

	it("holds back a dip the forecast sees below the reserve", () => {
		const plan = planInvestment(
			input({
				forecastLowestMinor: 700_000,
				forecastLowestDate: "2026-10-15",
			}),
		);
		expect(plan.upcomingMinor).toBe(300_000);
		expect(plan.keepMinor).toBe(1_300_000);
		expect(plan.bankFreeMinor).toBe(131_300);
		expect(plan.findings.map((finding) => finding.key)).toEqual(["upcoming"]);
		expect(plan.findings[0].text).toContain("15.10.2026");
	});

	it("buys only into instruments already held and names a class without one", () => {
		const plan = planInvestment(
			input({
				holdings: [
					{
						isin: "IE00B6R52259",
						name: "MSCI ACWI",
						bucket: "equity",
						valueMinor: 2_000_000,
					},
				],
				targets: { equity: 6000, bonds: 3000, cash: 1000, other: 0 },
			}),
		);
		expect(plan.buys.map((buy) => buy.isin)).toEqual(["IE00B6R52259"]);
		expect(plan.buys.every((buy) => buy.isin.length === 12)).toBe(true);
		expect(
			plan.findings.find((finding) => finding.key === "no_holding:bonds")?.text,
		).toContain("Anleihen");
		// Only what is bought is transferred; the bonds' share stays at the bank.
		const bought = plan.buys.reduce((sum, buy) => sum + buy.amountMinor, 0);
		expect(plan.transferMinor).toBe(bought - plan.brokerFreeMinor);
		expect(plan.transferMinor).toBeLessThan(plan.bankFreeMinor);
	});

	it("never sells: an overweight class is left for new money to dilute", () => {
		const plan = planInvestment(
			input({
				holdings: [
					{
						isin: "IE00B6R52259",
						name: "MSCI ACWI",
						bucket: "equity",
						valueMinor: 9_000_000,
					},
					{
						isin: "IE00BDBRDM35",
						name: "Anleihen ETF",
						bucket: "bonds",
						valueMinor: 500_000,
					},
				],
				targets: { equity: 6000, bonds: 3000, cash: 1000, other: 0 },
			}),
		);
		expect(plan.buys.map((buy) => buy.bucket)).toEqual(["bonds"]);
		expect(plan.buys.every((buy) => buy.amountMinor > 0)).toBe(true);
	});

	it("rounds buys down to whole euros and folds nothing below the minimum into an order", () => {
		const plan = planInvestment(
			input({
				bankCashMinor: 1_000_000,
				brokerCashMinor: MIN_ORDER_MINOR - 1,
			}),
		);
		expect(plan.buys).toEqual([]);
		expect(plan.findings.map((finding) => finding.key)).toEqual([
			"too_small:equity",
		]);
		const odd = planInvestment(input({ brokerCashMinor: 12_345 }));
		expect(odd.buys[0].amountMinor % 100).toBe(0);
	});

	it("never asks one account for more than it holds", () => {
		const plan = planInvestment(input({ transferLimitMinor: 300_000 }));
		expect(plan.bankFreeMinor).toBe(431_300);
		expect(plan.transferMinor).toBe(300_000);
		expect(plan.buys.map((buy) => buy.amountMinor)).toEqual([310_700]);
		expect(plan.findings.map((finding) => finding.key)).toEqual([
			"other_accounts",
		]);
		expect(
			planInvestment(input({ transferLimitMinor: null })).transferMinor,
		).toBe(0);
	});

	it("proposes nothing until the split totals 100 %", () => {
		const plan = planInvestment(
			input({ targets: { equity: 9000, bonds: 0, cash: 500, other: 0 } }),
		);
		expect(plan.ready).toBe(false);
		expect(plan.buys).toEqual([]);
		expect(plan.transferMinor).toBe(0);
	});

	it("leaves bank money alone without a reserve and invests only depot cash", () => {
		const plan = planInvestment(
			input({ reserveMinor: null, brokerCashMinor: 100_000 }),
		);
		expect(plan.bankFreeMinor).toBe(0);
		expect(plan.transferMinor).toBe(0);
		expect(plan.buys.map((buy) => buy.amountMinor)).toEqual([100_000]);
		expect(plan.findings.map((finding) => finding.key)).toContain("reserve");
	});

	it("warns about a stale snapshot and a short horizon", () => {
		const keys = planInvestment(
			input({ snapshotAgeDays: 9, horizonMonths: 12 }),
		).findings.map((finding) => finding.key);
		expect(keys).toEqual(["stale", "horizon"]);
	});

	it("describes the split in the owner's words", () => {
		expect(
			describeSplit({ equity: 9000, bonds: 0, cash: 1000, other: 0 }),
		).toBe("90 % Aktien / 10 % Cash");
	});
});
