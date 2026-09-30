import { describe, expect, it } from "vitest";
import { decryptBytes, encryptBytes } from "@/server/crypto";

describe("binary encryption", () => {
	it("round-trips contract document bytes", () => {
		const original = Buffer.from([0, 1, 2, 127, 128, 255]);
		const encrypted = encryptBytes(original);
		expect(encrypted).toMatch(/^v1\./);
		expect(decryptBytes(encrypted)).toEqual(original);
	});
});
