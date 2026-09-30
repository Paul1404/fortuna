import { describe, expect, it } from "vitest";
import { suggestedSavingDate } from "@/domain/optimization";

describe("suggestedSavingDate", () => {
	it("starts from the switch day, else today, without a contract", () => {
		expect(
			suggestedSavingDate("saving_from", { completedAt: "2026-08-01" }),
		).toBe("2026-08-01");
		expect(
			suggestedSavingDate("saving_from", { completedAt: null }, "2026-09-28"),
		).toBe("2026-09-28");
	});

	it("ends a contract the day before it renews, else at month end", () => {
		expect(
			suggestedSavingDate(
				"contract_end",
				{ completedAt: "2026-08-01", renewalDate: "2027-01-01" },
				"2026-09-28",
			),
		).toBe("2026-12-31");
		expect(
			suggestedSavingDate("contract_end", { completedAt: null }, "2026-09-28"),
		).toBe("2026-09-30");
	});
});
