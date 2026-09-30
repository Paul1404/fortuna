import { describe, expect, it } from "vitest";
import {
	niceTicks,
	visibleAxisLabelIndices,
} from "@/components/charts/use-measure";

describe("chart axes", () => {
	it("keeps grid labels inside a range that starts just below zero", () => {
		const ticks = niceTicks(-4_700_00, 63_500_00);
		expect(ticks).toEqual([0, 2_000_000, 4_000_000, 6_000_000]);
	});

	it("never places a tick outside the plotted range", () => {
		for (const [min, max] of [
			[-42_000_00, 63_000_00],
			[7_000_00, 15_000_00],
			[-3_200, 8_400],
			[12_345, 12_999],
		]) {
			const ticks = niceTicks(min, max);
			expect(ticks.length).toBeGreaterThan(0);
			expect(ticks.every((tick) => tick >= min && tick <= max)).toBe(true);
		}
	});

	it("leaves enough room before the final date label", () => {
		const indices = visibleAxisLabelIndices(12, 45);
		expect(indices).toEqual([0, 2, 4, 6, 8, 11]);
		expect(indices.at(-1)).toBe(11);
		expect((11 - (indices.at(-2) ?? 0)) * 45).toBeGreaterThanOrEqual(70);
		expect(visibleAxisLabelIndices(2, 50)).toEqual([1]);
	});
});
