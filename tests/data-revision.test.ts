import { describe, expect, it } from "vitest";
import { dataRevision, markDataChanged } from "@/server/data-revision";

describe("server data revision", () => {
	it("advances independently per owner", () => {
		const user = crypto.randomUUID();
		const other = crypto.randomUUID();
		expect(dataRevision(user)).toBe(0);
		expect(markDataChanged(user)).toBe(1);
		expect(markDataChanged(user)).toBe(2);
		expect(dataRevision(other)).toBe(0);
	});
});
