import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A page renders in the browser, where Node built-ins do not exist. Importing a
 * module that reaches one kills the route with "Module node:crypto has been
 * externalized" — and `bun run verify` cannot see it, because type-checking,
 * linting, tests and the build all succeed. /contracts shipped broken that way.
 *
 * This walks the import graph of every client route and fails on the first
 * `node:` import it can reach.
 */

const SRC = resolve(import.meta.dirname, "..", "src");
const ROUTES = join(SRC, "routes");

// Only value imports reach the browser: `import type` is erased by the
// compiler, and the generated route tree references server routes that the
// bundler drops from the client build.
const IMPORT_PATTERN =
	/(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:[^"'\n;]*?\sfrom\s+)?["']([^"']+)["']/g;
const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

async function clientRouteFiles(): Promise<string[]> {
	const entries = await readdir(ROUTES, {
		recursive: true,
		withFileTypes: true,
	});
	return (
		entries
			.filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
			.map((entry) => join(entry.parentPath, entry.name))
			// src/routes/api/** only ever runs on the server.
			.filter((file) => !file.includes(`${ROUTES}/api`))
			.filter((file) => !file.endsWith("routeTree.gen.ts"))
	);
}

function resolveImport(specifier: string, fromFile: string): string | null {
	const base = specifier.startsWith("@/")
		? join(SRC, specifier.slice(2))
		: specifier.startsWith(".")
			? resolve(dirname(fromFile), specifier)
			: null;
	if (!base) return null;
	for (const extension of ["", ...EXTENSIONS]) {
		const candidate = `${base}${extension}`;
		try {
			readFileSync(candidate, "utf8");
			return candidate;
		} catch {
			// Try the next extension.
		}
	}
	return null;
}

/** The chain from a route to a Node built-in, or null when there is none. */
function findNodeImport(entry: string): string[] | null {
	const seen = new Set<string>();
	const stack: { file: string; chain: string[] }[] = [
		{ file: entry, chain: [entry] },
	];
	while (stack.length) {
		const current = stack.pop();
		if (!current || seen.has(current.file)) continue;
		seen.add(current.file);
		let source: string;
		try {
			source = readFileSync(current.file, "utf8");
		} catch {
			continue;
		}
		for (const match of source.matchAll(IMPORT_PATTERN)) {
			const specifier = match[1];
			if (specifier.startsWith("node:")) return [...current.chain, specifier];
			const next = resolveImport(specifier, current.file);
			if (next && !seen.has(next))
				stack.push({ file: next, chain: [...current.chain, next] });
		}
	}
	return null;
}

describe("client routes", () => {
	it("never reach a Node built-in", async () => {
		const files = await clientRouteFiles();
		expect(files.length).toBeGreaterThan(10);
		const offenders = files
			.map((file) => ({ file, chain: findNodeImport(file) }))
			.filter((result) => result.chain)
			.map(({ chain }) =>
				(chain as string[])
					.map((step) => step.replace(`${SRC}/`, ""))
					.join("\n    → "),
			);
		expect(offenders).toEqual([]);
	});
});
