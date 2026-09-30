import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function filesBelow(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory()
			? filesBelow(path)
			: entry.name.endsWith(".tsx")
				? [path]
				: [];
	});
}

describe("sichtbare Inhalte", () => {
	it("schneidet Texte in Routen und gemeinsamen Komponenten nicht absichtlich ab", () => {
		const files = [
			...filesBelow(join(process.cwd(), "src/routes")),
			...filesBelow(join(process.cwd(), "src/components")),
		];
		const offenders = files.filter((file) =>
			/\btruncate\b/u.test(readFileSync(file, "utf8")),
		);
		expect(offenders).toEqual([]);
	});

	it("reserviert Safari genug Platz für lokalisierte Datumsfelder", () => {
		const input = readFileSync(
			join(process.cwd(), "src/components/ui/input.tsx"),
			"utf8",
		);
		const styles = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
		expect(input).toContain('type === "date" && "min-w-[10.5rem]');
		expect(styles).toContain('input[type="date"]');
		expect(styles).toContain("min-inline-size: 10.5rem");
	});

	it("uses phone-sized controls and a bottom sheet dialog", () => {
		const input = readFileSync(
			join(process.cwd(), "src/components/ui/input.tsx"),
			"utf8",
		);
		const button = readFileSync(
			join(process.cwd(), "src/components/ui/button.tsx"),
			"utf8",
		);
		const dialog = readFileSync(
			join(process.cwd(), "src/components/ui/dialog.tsx"),
			"utf8",
		);
		expect(input).toContain("h-11 w-full");
		expect(input).toContain("text-base");
		// 44 px wherever the pointer is a finger, not by window width.
		expect(button).toContain("pointer-coarse:min-h-11");
		// A bottom sheet on a phone that rises above the keyboard.
		expect(dialog).toContain("max-sm:bottom-[var(--keyboard-inset,0px)]");
		expect(dialog).toContain("function DialogFooter");
	});
});
