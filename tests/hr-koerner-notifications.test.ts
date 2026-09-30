import { describe, expect, it } from "vitest";
import { inAppNotificationEligible } from "@/domain/hr-koerner-notifications";

describe("Hr. Körner notification boundary", () => {
	it("delivers only open review and urgent findings in-app", () => {
		expect(
			inAppNotificationEligible({ status: "open", severity: "review" }),
		).toBe(true);
		expect(
			inAppNotificationEligible({ status: "open", severity: "urgent" }),
		).toBe(true);
		expect(
			inAppNotificationEligible({ status: "open", severity: "notable" }),
		).toBe(false);
		expect(
			inAppNotificationEligible({ status: "intentional", severity: "urgent" }),
		).toBe(false);
		expect(
			inAppNotificationEligible({ status: "snoozed", severity: "urgent" }),
		).toBe(false);
	});
});
