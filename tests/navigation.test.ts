import * as v from "valibot";
import { describe, expect, it } from "vitest";
import {
	ALL_NAV_ITEMS,
	HIDEABLE_NAV_ITEMS,
	hideableOnly,
	NAV_GROUPS,
	PALETTE_ONLY_ITEMS,
	visibleNavGroups,
} from "@/lib/navigation";
import { SettingsUpdate } from "@/lib/schemas";

describe("saved navigation visibility", () => {
	it("keeps the menu unchanged by default and hides selected items", () => {
		expect(visibleNavGroups([])).toEqual(NAV_GROUPS);
		const visible = visibleNavGroups(["/assets", "/debts", "/settings", "/"]);
		const paths = visible.flatMap((group) =>
			group.items.map((item) => item.href),
		);
		expect(paths).not.toContain("/assets");
		expect(paths).not.toContain("/debts");
		expect(paths).toContain("/");
		expect(paths).toContain("/settings");
	});
	it("offers only optional routes for hiding and validates bounded input", () => {
		expect(HIDEABLE_NAV_ITEMS.map((item) => item.href)).not.toContain("/");
		expect(HIDEABLE_NAV_ITEMS.map((item) => item.href)).not.toContain(
			"/settings",
		);
		expect(
			v.safeParse(SettingsUpdate, { hiddenNavItems: ["/assets"] }).success,
		).toBe(true);
		expect(
			v.safeParse(SettingsUpdate, {
				hiddenNavItems: Array.from({ length: 31 }, () => "/assets"),
			}).success,
		).toBe(false);
	});
	it("follows the owner's menu of 27.09.2026", () => {
		expect(ALL_NAV_ITEMS.map((item) => [item.href, item.label])).toEqual([
			["/", "Hr. Körner"],
			["/net-worth", "Vermögen"],
			["/accounts", "Konten & Depots"],
			["/assets", "Sachwerte"],
			["/debts", "Forderungen & Schulden"],
			["/transactions", "Umsätze"],
			["/cashflow", "Zahlungsfluss"],
			["/fixed-costs", "Fixkosten"],
			["/investment-plan", "Anlegen"],
			["/settings", "Einstellungen"],
		]);
		expect(NAV_GROUPS[0]?.items[0]).toMatchObject({ href: "/", exact: true });
		// Every entry has its own icon; Hr. Körner and the savings used to share one.
		const icons = ALL_NAV_ITEMS.map((item) => item.icon);
		expect(new Set(icons).size).toBe(icons.length);
	});
	it("keeps pages that left the menu reachable from the search", () => {
		const menu = ALL_NAV_ITEMS.map((item) => item.href);
		const extra = PALETTE_ONLY_ITEMS.map((item) => item.href);
		expect(extra).toContain("/copilot");
		expect(extra).toContain("/hr-koerner");
		expect(extra).toContain("/settings/data-sources");
		for (const href of ["/copilot", "/hr-koerner", "/settings/data-sources"])
			expect(menu).not.toContain(href);
	});
	it("drops saved hidden entries that are no longer in the menu", () => {
		// A list saved before the desk still names /hr-koerner and /copilot; the
		// server refuses both, so saving it unchanged would fail.
		expect(hideableOnly(["/hr-koerner", "/cash", "/copilot", "/"])).toEqual([]);
		// Pages merged on 27.09.2026 are gone from the menu the same way.
		expect(
			hideableOnly(["/overview", "/recap", "/recurring", "/debts", "/imports"]),
		).toEqual(["/debts"]);
	});
});
