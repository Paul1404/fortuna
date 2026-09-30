import { ORPCError } from "@orpc/server";
import { desc, eq } from "drizzle-orm";
import { FxTable } from "@/domain/fx";
import { HIDEABLE_NAV_ITEMS } from "@/lib/navigation";
import { db } from "@/server/db";
import { fxRates, userSettings } from "@/server/db/schema";

export type Settings = {
	baseCurrency: string;
	locale: string;
	analysisMonths: number;
	hiddenNavItems: string[];
};

export async function getSettings(userId: string): Promise<Settings> {
	const row = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, userId),
	});
	if (!row) {
		await db.insert(userSettings).values({ userId }).onConflictDoNothing();
		return {
			baseCurrency: "EUR",
			locale: "de-DE",
			analysisMonths: 12,
			hiddenNavItems: [],
		};
	}
	return {
		baseCurrency: row.baseCurrency,
		locale: row.locale,
		analysisMonths: row.analysisMonths,
		hiddenNavItems: row.hiddenNavItems,
	};
}

export async function updateSettings(
	userId: string,
	patch: Partial<Settings>,
): Promise<Settings> {
	if (patch.hiddenNavItems) {
		const allowed = new Set(HIDEABLE_NAV_ITEMS.map((item) => item.href));
		if (patch.hiddenNavItems.some((href) => !allowed.has(href)))
			throw new ORPCError("BAD_REQUEST", { message: "Ungültiger Menüeintrag" });
		patch = { ...patch, hiddenNavItems: [...new Set(patch.hiddenNavItems)] };
	}
	await db
		.insert(userSettings)
		.values({ userId, ...patch })
		.onConflictDoUpdate({
			target: userSettings.userId,
			set: { ...patch, updatedAt: new Date() },
		});
	return getSettings(userId);
}

/** All FX rates, loaded once per request into an in-memory table. */
export async function loadFxTable(): Promise<FxTable> {
	const rows = await db.select().from(fxRates);
	return new FxTable(
		rows.map((r) => ({
			date: r.date,
			base: r.base,
			quote: r.quote,
			rate: r.rate,
		})),
	);
}

export async function listFxRates(): Promise<
	{ date: string; base: string; quote: string; rate: number; source: string }[]
> {
	const rows = await db.select().from(fxRates).orderBy(desc(fxRates.date));
	return rows.map((r) => ({
		date: r.date,
		base: r.base,
		quote: r.quote,
		rate: r.rate,
		source: r.source,
	}));
}

export async function upsertFxRate(input: {
	date: string;
	base: string;
	quote: string;
	rate: number;
	source?: string;
}): Promise<void> {
	await db
		.insert(fxRates)
		.values({ ...input, source: input.source ?? "manual" })
		.onConflictDoUpdate({
			target: [fxRates.base, fxRates.quote, fxRates.date],
			set: { rate: input.rate, source: input.source ?? "manual" },
		});
}
