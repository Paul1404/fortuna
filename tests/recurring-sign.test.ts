import { describe, expect, it } from "vitest";
import { signedRecurringAmount } from "@/server/services/recurring";

describe("signedRecurringAmount", () => {
	it("lets the direction decide the sign, whatever the caller sent", () => {
		expect(signedRecurringAmount("outflow", 2270)).toBe(-2270);
		expect(signedRecurringAmount("outflow", -2270)).toBe(-2270);
		expect(signedRecurringAmount("inflow", -453134)).toBe(453134);
		expect(signedRecurringAmount("inflow", 453134)).toBe(453134);
	});
});
