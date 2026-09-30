import { describe, expect, it } from "vitest";
import { bridgePath, tickAmplitude } from "@/domain/market-ticker";

/** Deterministic noise so the bounds are checked on a fixed path. */
function seeded(seed: number) {
	let state = seed;
	return () => {
		state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
		return state / 2_147_483_648;
	};
}

describe("bridgePath", () => {
	it("always lands exactly on the real reading", () => {
		for (let seed = 1; seed < 50; seed++) {
			const path = bridgePath(34_832_055, 34_835_505, 15, 800, seeded(seed));
			expect(path).toHaveLength(15);
			expect(path.at(-1)).toBe(34_835_505);
		}
	});

	it("never wanders further than the amplitude from the straight line", () => {
		for (let seed = 1; seed < 50; seed++) {
			const from = 1_000_000;
			const to = 1_003_000;
			const path = bridgePath(from, to, 15, 500, seeded(seed));
			path.forEach((value, i) => {
				const line = from + ((to - from) * (i + 1)) / 15;
				expect(Math.abs(value - line)).toBeLessThanOrEqual(501);
			});
		}
	});

	it("is a plain line when the market does not move", () => {
		expect(bridgePath(500, 500, 5, 0)).toEqual([500, 500, 500, 500, 500]);
		expect(bridgePath(0, 1_000, 4, 0)).toEqual([250, 500, 750, 1_000]);
	});
});

describe("tickAmplitude", () => {
	it("stands still when the last two readings did not move", () => {
		expect(tickAmplitude([]).valueOf()).toBe(0);
		expect(tickAmplitude([1_200, 0, 0])).toBe(0);
	});

	it("scales with the moves the real readings made", () => {
		expect(tickAmplitude([400, -600, 500])).toBe(250);
		// A sudden bigger move widens it at once.
		expect(tickAmplitude([100, 100, -2_000])).toBe(1_000);
	});
});
