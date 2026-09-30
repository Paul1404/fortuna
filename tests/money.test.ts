import { describe, expect, it } from "vitest";
import { FxTable, sumInBase } from "@/domain/fx";
import {
	add,
	CurrencyMismatchError,
	formatMoney,
	money,
	parseDecimalToMinor,
	percentChange,
	sumSameCurrency,
} from "@/domain/money";

describe("money", () => {
	it("adds same-currency amounts and rejects mixed currencies", () => {
		expect(add(money(1050, "eur"), money(-50, "EUR"))).toEqual({
			amountMinor: 1000,
			currency: "EUR",
		});
		expect(() => add(money(1, "EUR"), money(1, "USD"))).toThrow(
			CurrencyMismatchError,
		);
		expect(() =>
			sumSameCurrency([money(1, "EUR"), money(1, "CHF")], "EUR"),
		).toThrow(CurrencyMismatchError);
	});

	it("parses German and English decimal notations", () => {
		expect(parseDecimalToMinor("1.234,56")).toBe(123456);
		expect(parseDecimalToMinor("1,234.56")).toBe(123456);
		expect(parseDecimalToMinor("-12,30")).toBe(-1230);
		expect(parseDecimalToMinor("12,30-")).toBe(-1230);
		expect(parseDecimalToMinor("€ 5")).toBe(500);
		expect(parseDecimalToMinor("abc")).toBeNull();
		expect(parseDecimalToMinor("")).toBeNull();
		expect(parseDecimalToMinor(12.345)).toBe(1235);
	});

	it("rounds a half cent up instead of losing it to float error", () => {
		expect(parseDecimalToMinor("1,005")).toBe(101);
		expect(parseDecimalToMinor("0,145")).toBe(15);
		expect(parseDecimalToMinor("8,165")).toBe(817);
		expect(parseDecimalToMinor("1234,565")).toBe(123457);
		expect(parseDecimalToMinor(1.005)).toBe(101);
		expect(parseDecimalToMinor("1,004")).toBe(100);
		expect(parseDecimalToMinor("-1,005")).toBe(-101);
	});

	it("formats with a real minus sign and optional plus", () => {
		expect(formatMoney(-123456, "EUR")).toBe("−1.234,56 €");
		expect(formatMoney(123456, "EUR", { signed: true })).toBe("+1.234,56 €");
		expect(formatMoney(0, "EUR", { signed: true })).toBe("0,00 €");
		expect(formatMoney(123456, "EUR", { locale: "de-DE" })).toMatch(
			/1\.234,56/,
		);
	});

	it("percent change handles zero base", () => {
		expect(percentChange(0, 10)).toBeNull();
		expect(percentChange(100, 150)).toBe(50);
		expect(percentChange(-100, -50)).toBe(50);
	});
});

describe("fx", () => {
	const fx = new FxTable([
		{ date: "2026-01-01", base: "EUR", quote: "USD", rate: 1.1 },
		{ date: "2026-06-01", base: "EUR", quote: "USD", rate: 1.2 },
	]);

	it("uses the latest rate at or before the date and inverts pairs", () => {
		expect(fx.rate("EUR", "USD", "2026-03-01")).toBe(1.1);
		expect(fx.rate("EUR", "USD", "2026-09-01")).toBe(1.2);
		expect(fx.rate("USD", "EUR", "2026-09-01")).toBeCloseTo(1 / 1.2);
		expect(fx.rate("EUR", "EUR", "2026-09-01")).toBe(1);
		expect(fx.rate("EUR", "CHF", "2026-09-01")).toBeNull();
	});

	it("uses the newer of a pair's two directions", () => {
		// A rate typed in as CHF → EUR in January and as EUR → CHF in
		// September: the September one is the rate, whichever way round it is.
		const both = new FxTable([
			{ date: "2026-01-10", base: "CHF", quote: "EUR", rate: 1 },
			{ date: "2026-09-01", base: "EUR", quote: "CHF", rate: 0.9 },
		]);
		expect(both.rate("CHF", "EUR", "2026-09-28")).toBeCloseTo(1 / 0.9);
		expect(both.rate("EUR", "CHF", "2026-09-28")).toBe(0.9);
		// Before the newer one existed, the older one still applies.
		expect(both.rate("CHF", "EUR", "2026-05-01")).toBe(1);
		expect(both.rate("EUR", "CHF", "2026-05-01")).toBe(1);
		expect(both.convert(10_000, "CHF", "EUR", "2026-09-28")).toEqual({
			amountMinor: 11_111,
			missing: false,
		});
	});

	it("falls back to the earliest rate before history starts", () => {
		expect(fx.rate("EUR", "USD", "2025-01-01")).toBe(1.1);
	});

	it("never sums unconverted currencies silently", () => {
		const result = sumInBase(
			[
				{ amountMinor: 1000, currency: "EUR" },
				{ amountMinor: 1200, currency: "USD" },
				{ amountMinor: 999, currency: "CHF" },
			],
			"EUR",
			fx,
			"2026-09-01",
		);
		expect(result.totalMinor).toBe(1000 + Math.round(1200 / 1.2));
		expect(result.unconverted).toEqual(["CHF"]);
	});
});
