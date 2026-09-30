import { describe, expect, it } from "vitest";
import {
	monthlyEquivalentMinor,
	optimizationCategoryForTitle,
	optimizationSavings,
	realizedSavingsMinor,
	savingsMilestone,
	savingsProgress,
} from "@/domain/optimization";

describe("Sparmissionen", () => {
	it("rechnet die Amex-Ersparnis live über mehrere Zeiträume", () => {
		const savings = optimizationSavings({
			currentMonthlyMinor: 2_000,
			alternativeMonthlyMinor: 0,
			oneTimeCostMinor: 0,
		});
		expect(savings.monthlyMinor).toBe(2_000);
		expect(savings.annualMinor).toBe(24_000);
		expect(savings.threeYearsMinor).toBe(72_000);
		expect(savings.fiveYearsMinor).toBe(120_000);
		expect(savings.paybackMonths).toBe(0);
	});

	it("zieht Wechselkosten ab und berechnet die Amortisation", () => {
		const savings = optimizationSavings({
			currentMonthlyMinor: 5_000,
			alternativeMonthlyMinor: 3_000,
			oneTimeCostMinor: 6_000,
		});
		expect(savings.firstYearMinor).toBe(18_000);
		expect(savings.paybackMonths).toBe(3);
	});

	it("berechnet realisierte Ersparnis zeitanteilig", () => {
		expect(
			realizedSavingsMinor(
				{
					currentMonthlyMinor: 2_000,
					alternativeMonthlyMinor: 0,
					oneTimeCostMinor: 0,
				},
				"2026-01-01",
				"2026-07-01",
			),
		).toBeGreaterThan(11_800);
	});

	it("normalisiert wiederkehrende Kosten auf einen Monat", () => {
		expect(monthlyEquivalentMinor(12_000, "yearly")).toBe(1_000);
		expect(monthlyEquivalentMinor(1_000, "weekly")).toBe(4_333);
	});

	it("ordnet Kartenentgelte als Bankkosten ein", () => {
		expect(optimizationCategoryForTitle("American Express Kartenentgelt")).toBe(
			"banking",
		);
		expect(optimizationCategoryForTitle("DEVK Versicherung")).toBe("insurance");
	});

	it("setzt den nächsten echten Euro-Meilenstein", () => {
		expect(savingsMilestone(32_000)).toEqual({
			previousMinor: 25_000,
			nextMinor: 50_000,
			progress: 0.28,
		});
	});
});

describe("savings phases", () => {
	const costs = {
		currentMonthlyMinor: 8_900,
		alternativeMonthlyMinor: 4_900,
		oneTimeCostMinor: 0,
	};

	it("waits while the cancelled contract still runs", () => {
		const progress = savingsProgress(
			costs,
			{
				status: "completed",
				savingFrom: null,
				oldContract: { endsOn: "2026-10-31" },
			},
			"2026-09-19",
		);
		expect(progress.phase).toBe("waiting");
		// The old price is still being paid, so nothing has been saved yet.
		expect(progress.realizedMinor).toBe(0);
		expect(progress.savingFrom).toBe("2026-11-01");
		expect(progress.daysUntilSaving).toBe(43);
	});

	it("starts counting the day after the old contract ends", () => {
		const progress = savingsProgress(
			costs,
			{
				status: "completed",
				savingFrom: null,
				oldContract: { endsOn: "2026-10-31" },
			},
			"2026-12-01",
		);
		expect(progress.phase).toBe("saving");
		// One month at 40 €, not the two and a half months since "Umgesetzt".
		expect(progress.realizedMinor).toBeGreaterThan(3_900);
		expect(progress.realizedMinor).toBeLessThan(4_100);
	});

	it("shows an unrecovered switching cost as what is left, not as a loss", () => {
		const withFee = { ...costs, oneTimeCostMinor: 120_000 };
		const progress = savingsProgress(
			withFee,
			{ status: "completed", savingFrom: "2026-07-01" },
			"2026-09-19",
		);
		expect(progress.phase).toBe("earning_back");
		expect(progress.realizedMinor).toBe(0);
		expect(progress.outstandingCostMinor).toBeGreaterThan(0);
		// 1.200 € fee against 40 € a month is 30 months, and it says the date.
		expect(progress.paybackOn).toBe("2028-12-31");
	});

	it("says there is no saving when the alternative costs more", () => {
		// 10 € a month dearer plus a 50 € fee: this never pays for itself, so it
		// must not sit in "earning back" with a growing amount outstanding.
		const dearer = {
			currentMonthlyMinor: 2_000,
			alternativeMonthlyMinor: 3_000,
			oneTimeCostMinor: 5_000,
		};
		const early = savingsProgress(
			dearer,
			{ status: "completed", savingFrom: "2026-01-01" },
			"2026-02-01",
		);
		const late = savingsProgress(
			dearer,
			{ status: "completed", savingFrom: "2026-01-01" },
			"2026-09-01",
		);
		for (const progress of [early, late]) {
			expect(progress.phase).toBe("no_saving");
			expect(progress.realizedMinor).toBe(0);
			expect(progress.outstandingCostMinor).toBe(0);
			expect(progress.paybackOn).toBeNull();
		}
	});

	it("says there is no saving when the alternative costs the same", () => {
		const same = {
			currentMonthlyMinor: 2_000,
			alternativeMonthlyMinor: 2_000,
			oneTimeCostMinor: 1_000,
		};
		expect(
			savingsProgress(
				same,
				{ status: "completed", savingFrom: "2026-01-01" },
				"2026-09-01",
			).phase,
		).toBe("no_saving");
	});

	it("counts from the owner's own date with no contract linked", () => {
		const progress = savingsProgress(
			costs,
			{ status: "completed", savingFrom: "2026-08-19" },
			"2026-09-19",
		);
		expect(progress.savingFrom).toBe("2026-08-19");
		expect(progress.phase).toBe("saving");
	});

	it("claims nothing without a date the old cost stops", () => {
		// Ticked off, no contract, no date: the subscription may well still be
		// charged until its paid year ends.
		const progress = savingsProgress(
			costs,
			{ status: "completed", savingFrom: null },
			"2026-09-19",
		);
		expect(progress.phase).toBe("undated");
		expect(progress.missing).toBe("saving_from");
		expect(progress.realizedMinor).toBe(0);
	});

	it("waits for a linked contract that has no end yet", () => {
		// The contract owns the date; the owner's own date cannot overrule a
		// contract that is still running.
		const progress = savingsProgress(
			costs,
			{
				status: "completed",
				savingFrom: "2026-08-01",
				oldContract: { endsOn: null },
			},
			"2026-09-19",
		);
		expect(progress.phase).toBe("undated");
		expect(progress.missing).toBe("contract_end");
		expect(progress.realizedMinor).toBe(0);
	});

	it("shows a future date as 'ab' rather than as money saved", () => {
		const progress = savingsProgress(
			costs,
			{ status: "completed", savingFrom: "2026-12-01" },
			"2026-09-19",
		);
		expect(progress.phase).toBe("waiting");
		expect(progress.savingFrom).toBe("2026-12-01");
		expect(progress.realizedMinor).toBe(0);
	});

	it("is all potential until the switch happens", () => {
		expect(
			savingsProgress(costs, { status: "planned", savingFrom: null }).phase,
		).toBe("planned");
	});
});
