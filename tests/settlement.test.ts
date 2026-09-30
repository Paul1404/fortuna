import { describe, expect, it } from "vitest";
import {
	amountInputText,
	balanceDateProblem,
	cashDescription,
	previewPayment,
	repaidShare,
	splitRate,
	splitSettled,
} from "@/domain/settlement";

describe("previewPayment", () => {
	it("leaves the rest open after a partial repayment", () => {
		expect(previewPayment(20_000, 5_000)).toEqual({
			remainingMinor: 15_000,
			overpaidMinor: 0,
			settles: false,
		});
	});

	it("settles on the exact amount", () => {
		expect(previewPayment(20_000, 20_000).settles).toBe(true);
	});

	it("never goes below zero and reports the excess", () => {
		expect(previewPayment(20_000, 25_000)).toEqual({
			remainingMinor: 0,
			overpaidMinor: 5_000,
			settles: true,
		});
	});

	it("treats an empty payment as nothing paid", () => {
		expect(previewPayment(20_000, 0).remainingMinor).toBe(20_000);
		expect(previewPayment(20_000, -100).remainingMinor).toBe(20_000);
	});
});

describe("balanceDateProblem", () => {
	const today = "2026-09-28";

	it("accepts today and any day since the last observation", () => {
		expect(
			balanceDateProblem(today, { balanceAsOf: "2026-09-01", today }),
		).toBe(null);
		expect(
			balanceDateProblem("2026-09-01", { balanceAsOf: "2026-09-01", today }),
		).toBe(null);
		expect(balanceDateProblem("2020-01-01", { balanceAsOf: null, today })).toBe(
			null,
		);
	});

	it("rejects a date before the last observation, which would change nothing today", () => {
		expect(
			balanceDateProblem("2026-08-31", { balanceAsOf: "2026-09-01", today }),
		).toMatch(/vor dem letzten Stand/);
	});

	it("rejects the future and a missing date", () => {
		expect(
			balanceDateProblem("2026-09-29", { balanceAsOf: null, today }),
		).toMatch(/Zukunft/);
		expect(balanceDateProblem("", { balanceAsOf: null, today })).toMatch(
			/Datum/,
		);
	});
});

describe("repaidShare", () => {
	it("is the repaid part of the original amount", () => {
		expect(repaidShare(30_000, 20_000)).toBeCloseTo(1 / 3);
	});

	it("is clamped and empty without an original amount", () => {
		expect(repaidShare(10_000, 12_000)).toBe(0);
		expect(repaidShare(10_000, 0)).toBe(1);
		expect(repaidShare(null, 5_000)).toBe(null);
		expect(repaidShare(0, 5_000)).toBe(null);
	});
});

describe("splitRate", () => {
	it("takes a month's interest out of an annuity rate", () => {
		// 171.667,77 € at 3,5 %: 500,70 € interest in a 931,40 € rate.
		expect(splitRate(17_166_777, 93_140, 350)).toEqual({
			interestMinor: 50_070,
			principalMinor: 43_070,
		});
	});

	it("counts the whole rate as repayment without an interest rate", () => {
		expect(splitRate(100_000, 20_000, null)).toEqual({
			interestMinor: 0,
			principalMinor: 20_000,
		});
	});

	it("never repays more than is owed or less than nothing", () => {
		expect(splitRate(5_000, 20_000, null).principalMinor).toBe(5_000);
		expect(splitRate(10_000_000, 1_000, 1_200)).toEqual({
			interestMinor: 1_000,
			principalMinor: 0,
		});
	});
});

describe("splitSettled", () => {
	it("keeps open and settled rows apart in their order", () => {
		const rows = [
			{ id: "a", isActive: true },
			{ id: "b", isActive: false },
			{ id: "c", isActive: true },
		];
		const { open, settled } = splitSettled(rows);
		expect(open.map((row) => row.id)).toEqual(["a", "c"]);
		expect(settled.map((row) => row.id)).toEqual(["b"]);
	});
});

describe("amountInputText", () => {
	it("writes a German decimal without grouping", () => {
		expect(amountInputText(29_197)).toBe("291,97");
		expect(amountInputText(3_510_000)).toBe("35100,00");
		expect(amountInputText(5)).toBe("0,05");
		expect(amountInputText(-150)).toBe("-1,50");
		expect(amountInputText(null)).toBe("");
	});
});

describe("cashDescription", () => {
	it("prefers the note, then the category, then the direction", () => {
		expect(cashDescription(" Bäcker ", "Lebensmittel", "outflow")).toBe(
			"Bäcker",
		);
		expect(cashDescription("", "Lebensmittel", "outflow")).toBe("Lebensmittel");
		expect(cashDescription(null, null, "outflow")).toBe("Barausgabe");
		expect(cashDescription(undefined, " ", "inflow")).toBe("Bareinnahme");
	});
});
