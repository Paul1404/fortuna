import { describe, expect, it } from "vitest";
import { wrapSankeyLabel } from "@/components/charts/sankey";

describe("Sankey labels", () => {
	it("wraps long holding names without losing words", () => {
		const label = "Rolex Oyster Perpetual 36 Diamond Dial Full Set";
		const lines = wrapSankeyLabel(label, 20);
		expect(lines.join(" ")).toBe(label);
		expect(lines.every((line) => line.length <= 20)).toBe(true);
	});

	it("breaks a single long word rather than clipping it", () => {
		const label = "A".repeat(45);
		const lines = wrapSankeyLabel(label, 20);
		expect(lines.join("")).toBe(label);
		expect(lines.every((line) => line.length <= 20)).toBe(true);
	});
});
