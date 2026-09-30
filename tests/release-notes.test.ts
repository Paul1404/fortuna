import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseReleases, RELEASES } from "@/lib/release-notes";

describe("release notes", () => {
	it("parses wrapped list entries", () => {
		expect(
			parseReleases(
				"# Changelog\n\n## 1.2.3 - 2026-09-14\n\n- Erste Zeile\n  zweite Zeile\n",
			),
		).toEqual([
			{
				version: "1.2.3",
				date: "2026-09-14",
				notes: ["Erste Zeile zweite Zeile"],
			},
		]);
	});

	it("keeps the visible release in sync with package.json", () => {
		const packageJson = JSON.parse(
			readFileSync(
				fileURLToPath(new URL("../package.json", import.meta.url)),
				"utf8",
			),
		) as { version: string };
		expect(RELEASES[0]?.version).toBe(packageJson.version);
		expect(RELEASES[0]?.notes.length).toBeGreaterThan(0);
	});
});
