import { describe, expect, it } from "vitest";
import {
	inAppNotificationEligible,
	type NotificationCandidate,
	observationEnabled,
} from "@/domain/hr-koerner-notifications";

const problem: NotificationCandidate = {
	type: "liquidity_below_floor",
	actionable: true,
	severity: "urgent",
	status: "open",
	readAt: null,
};

describe("calm notification policy", () => {
	it("notifies only about unread, open problems with a concrete consequence", () => {
		expect(inAppNotificationEligible(problem)).toBe(true);
		expect(
			inAppNotificationEligible({
				...problem,
				type: "upcoming_large_payment",
				severity: "review",
			}),
		).toBe(true);
		for (const status of [
			"intentional",
			"snoozed",
			"dismissed",
			"resolved",
		] as const)
			expect(inAppNotificationEligible({ ...problem, status })).toBe(false);
		expect(inAppNotificationEligible({ ...problem, readAt: new Date() })).toBe(
			false,
		);
		expect(inAppNotificationEligible({ ...problem, actionable: false })).toBe(
			false,
		);
		for (const type of [
			"unusual_spend",
			"repeated_small_leak",
			"recurring_price_increase",
			"lifestyle_creep",
			"stale_asset_valuation",
		])
			expect(inAppNotificationEligible({ ...problem, type })).toBe(false);
	});

	it("applies quiet mode to optional findings even if old rows have review severity", () => {
		for (const sensitivity of ["quiet", "balanced", "detailed"] as const) {
			expect(observationEnabled(problem, sensitivity)).toBe(true);
			expect(
				observationEnabled(
					{ ...problem, type: "stale_asset_valuation" },
					sensitivity,
				),
			).toBe(false);
			for (const type of ["unusual_spend", "repeated_small_leak"])
				expect(observationEnabled({ ...problem, type }, sensitivity)).toBe(
					sensitivity === "detailed",
				);
		}
		expect(
			observationEnabled(
				{ ...problem, type: "recurring_price_increase" },
				"quiet",
			),
		).toBe(false);
	});
});
