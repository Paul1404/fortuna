import { describe, expect, it } from "vitest";
import {
	addMonths,
	daysBetween,
	endOfMonth,
	formatDateTime,
	isIsoDate,
	monthRange,
	todayIso,
} from "@/domain/dates";

describe("dates", () => {
	it("validates ISO dates strictly", () => {
		expect(isIsoDate("2026-02-29")).toBe(false);
		expect(isIsoDate("2024-02-29")).toBe(true);
		expect(isIsoDate("2026-13-01")).toBe(false);
	});
	it("adds months clamping to month end", () => {
		expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
		expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
		expect(addMonths("2026-11-15", 2)).toBe("2027-01-15");
	});
	it("builds month ranges and month ends", () => {
		expect(monthRange("2025-11-20", "2026-02-01")).toEqual([
			"2025-11",
			"2025-12",
			"2026-01",
			"2026-02",
		]);
		expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
		expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30);
	});
	it("uses the German calendar date around UTC midnight", () => {
		expect(todayIso(new Date("2026-09-15T22:30:00Z"))).toBe("2026-09-16");
		expect(todayIso(new Date("2026-01-15T23:30:00Z"))).toBe("2026-01-16");
	});

	it("prints timestamps in Berlin time whatever zone the server runs in", () => {
		// 22:30 UTC in summer is 00:30 the next day in Berlin.
		expect(formatDateTime("2026-09-15T22:30:00Z")).toBe("16.09.2026, 00:30");
		expect(formatDateTime(new Date("2026-01-15T12:05:00Z"))).toBe(
			"15.01.2026, 13:05",
		);
	});
});
