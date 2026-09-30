import { describe, expect, it } from "vitest";
import { cagr } from "@/server/services/dashboard";

describe("dashboard growth", () => {
	it("shows ordinary annualised growth", () => {
		expect(cagr(10_000, 11_000, 365)).toBeCloseTo(10);
	});

	it("suppresses explosive rates caused by an almost empty starting snapshot", () => {
		expect(cagr(1, 5_644_091, 180)).toBeNull();
	});
});
