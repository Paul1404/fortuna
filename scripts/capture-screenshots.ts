/**
 * Captures the README screenshots from a running dev server.
 *
 * Only for the fictional scenario of `bun run db:seed:preview`: the script
 * refuses any database that is not a local `fortuna_demo_*` one, so the
 * owner's real figures can never end up in a published image. See
 * `docs/screenshot-preview.md`.
 *
 * Usage: `bun run screenshots [outDir]` with `bun run dev` running against
 * the demo database. Credentials come from OWNER_EMAIL and OWNER_PASSWORD.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type Browser, chromium } from "playwright";
import { assertLocalBootstrapTarget } from "@/server/db/local-bootstrap";

const BASE = process.env.SCREENSHOT_BASE ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "docs/screenshots";

type Shot = {
	file: string;
	path: string;
	/** Light unless stated; the navigation rail is navy in both. */
	theme?: "light" | "dark";
};

const DESKTOP: Shot[] = [
	{ file: "desk", path: "/" },
	{ file: "net-worth", path: "/net-worth" },
	{ file: "cashflow", path: "/cashflow" },
	{ file: "fixed-costs", path: "/fixed-costs" },
	{ file: "desk-dark", path: "/", theme: "dark" },
];

const PHONE: Shot[] = [
	{ file: "phone-desk", path: "/" },
	{ file: "phone-net-worth", path: "/net-worth" },
];

async function capture(
	browser: Browser,
	cookies: Awaited<
		ReturnType<Awaited<ReturnType<Browser["newContext"]>>["cookies"]>
	>,
	shots: Shot[],
	viewport: { width: number; height: number },
	phone: boolean,
) {
	for (const shot of shots) {
		// Twice the pixels, so the images stay sharp on a high-density display.
		const context = await browser.newContext({
			viewport,
			deviceScaleFactor: 2,
			reducedMotion: "reduce",
			colorScheme: shot.theme ?? "light",
			locale: "de-DE",
			timezoneId: "Europe/Berlin",
			isMobile: phone,
			hasTouch: phone,
		});
		await context.addCookies(cookies);
		const page = await context.newPage();
		await page.goto(`${BASE}${shot.path}`, { waitUntil: "networkidle" });
		await page.evaluate(() => document.fonts.ready);
		// Charts measure their container after the first paint.
		await page.waitForTimeout(600);
		await page.screenshot({ path: join(OUT, `${shot.file}.png`) });
		console.log(`  ok  ${shot.file}.png`);
		await context.close();
	}
}

async function main() {
	const target = process.env.DATABASE_URL ?? "";
	assertLocalBootstrapTarget(target, process.env.NODE_ENV);
	if (!new URL(target).pathname.startsWith("/fortuna_demo_"))
		throw new Error("Screenshots come from a fortuna_demo_* database only.");
	const email = process.env.OWNER_EMAIL;
	const password = process.env.OWNER_PASSWORD;
	if (!email || !password)
		throw new Error("OWNER_EMAIL and OWNER_PASSWORD must be set.");

	await mkdir(OUT, { recursive: true });
	const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
	const browser = await chromium.launch(
		executablePath ? { executablePath } : {},
	);
	// One login, reused: better-auth rate-limits repeated sign-ins.
	const login = await browser.newContext();
	const page = await login.newPage();
	await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
	await page.fill('input[type="email"]', email);
	await page.fill('input[type="password"]', password);
	await page.click('button[type="submit"]');
	await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
		timeout: 30_000,
	});
	const cookies = await login.cookies();
	await login.close();

	await capture(browser, cookies, DESKTOP, { width: 1440, height: 900 }, false);
	await capture(browser, cookies, PHONE, { width: 390, height: 844 }, true);
	await browser.close();
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
