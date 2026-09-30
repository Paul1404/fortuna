/**
 * Loads every authenticated route in a real browser and fails on a page that
 * did not render.
 *
 * `bun run verify` type-checks, lints, tests and builds, and all four passed on
 * the day /contracts was completely broken: nothing in the toolchain loads a
 * page. `tests/route-imports.test.ts` now covers that specific cause without a
 * browser; this covers the rest — a render that throws, a loader that rejects,
 * a query that 500s.
 *
 * Usage: `bun run smoke` with the dev server running (`bun run dev`).
 * Credentials come from OWNER_EMAIL and OWNER_PASSWORD in .env.
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3000";

const ROUTES = [
	"/",
	"/hr-koerner",
	"/copilot",
	"/net-worth",
	"/accounts",
	"/assets",
	"/debts",
	"/debts?tab=liabilities",
	"/transactions",
	"/cashflow",
	"/fixed-costs",
	"/investment-plan",
	"/settings",
	"/settings/data-sources",
	"/settings/hr-koerner",
	// Merged pages redirect; the old links, bookmarks and desk tasks still
	// have to land on a page that renders.
	"/overview",
	"/recap",
	"/cash",
	"/recurring",
	"/contracts",
	"/optimizations",
	"/receivables",
	"/liabilities",
	"/imports",
	"/connections",
	"/investments",
];

/** The error boundary's heading, which replaces a page that failed to render. */
const ERROR_MARKER = "Etwas ist schiefgelaufen";

/** Noise that says nothing about whether the page works. */
function isIgnorable(text: string): boolean {
	return (
		text.includes("Download the React DevTools") ||
		text.includes("[vite] connected") ||
		text.includes("favicon")
	);
}

async function main() {
	const email = process.env.OWNER_EMAIL;
	const password = process.env.OWNER_PASSWORD;
	if (!email || !password) {
		console.error("OWNER_EMAIL and OWNER_PASSWORD must be set (see .env).");
		process.exit(2);
	}

	// A preinstalled Chromium that does not match this Playwright version is
	// used through its path instead of downloading another one.
	const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
	const browser = await chromium.launch(
		executablePath ? { executablePath } : {},
	);
	const page = await browser.newPage();
	const failures: string[] = [];
	let route = "/login";
	page.on("console", (message) => {
		if (message.type() !== "error" || isIgnorable(message.text())) return;
		failures.push(`${route}: console error — ${message.text().slice(0, 200)}`);
	});
	page.on("pageerror", (error) => {
		failures.push(`${route}: uncaught — ${error.message.slice(0, 200)}`);
	});
	page.on("response", (response) => {
		if (response.status() < 500) return;
		failures.push(`${route}: ${response.status()} from ${response.url()}`);
	});

	await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
	await page.fill('input[type="email"]', email);
	await page.fill('input[type="password"]', password);
	await page.click('button[type="submit"]');
	await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
		timeout: 30_000,
	});

	for (const target of ROUTES) {
		route = target;
		await page.goto(`${BASE}${target}`, { waitUntil: "networkidle" });
		const body = (await page.textContent("body")) ?? "";
		if (body.includes(ERROR_MARKER))
			failures.push(`${target}: rendered the error boundary`);
		else if (body.trim().length < 40)
			failures.push(`${target}: rendered nothing`);
		else console.log(`  ok  ${target}`);
	}

	// The same routes at phone width: a page that scrolls sideways hides
	// part of itself, and a clipped amount reads as a whole number.
	await page.setViewportSize({ width: 390, height: 844 });
	for (const target of ROUTES) {
		route = `${target} @390`;
		await page.goto(`${BASE}${target}`, { waitUntil: "networkidle" });
		const overflow = await page.evaluate(() => {
			const root = document.documentElement;
			if (root.scrollWidth <= root.clientWidth) return null;
			const widest = [...document.body.querySelectorAll("*")]
				.filter((el) => el.getBoundingClientRect().right > root.clientWidth + 1)
				.map((el) => {
					const cls =
						typeof el.className === "string"
							? el.className.split(" ").slice(0, 3).join(".")
							: "";
					return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}`;
				})
				.slice(-1)[0];
			return `${root.scrollWidth}px wide (${widest ?? "?"})`;
		});
		if (overflow)
			failures.push(`${target}: scrolls sideways at 390 px, ${overflow}`);
		else console.log(`  ok  ${target} @390`);
	}
	await browser.close();

	if (failures.length > 0) {
		console.error(`\n${failures.length} problem(s):`);
		for (const failure of failures) console.error(`  - ${failure}`);
		process.exit(1);
	}
	console.log(
		`\nAll ${ROUTES.length} routes rendered, and none scrolls sideways at 390 px.`,
	);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
