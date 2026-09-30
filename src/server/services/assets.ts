import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { todayIso } from "@/domain/dates";
import { type DbOrTx, db } from "@/server/db";
import {
	type Asset,
	type AssetValuation,
	assets,
	assetValuations,
	liabilities,
} from "@/server/db/schema";

export type AssetRow = Asset & {
	valuationCount: number;
	linkedLiabilityName: string | null;
	linkedLiabilityBalanceMinor: number | null;
};

export async function listAssets(
	userId: string,
	options: { includeInactive?: boolean } = {},
): Promise<AssetRow[]> {
	const rows = await db.query.assets.findMany({
		where: options.includeInactive
			? eq(assets.userId, userId)
			: and(eq(assets.userId, userId), eq(assets.isActive, true)),
		with: { valuations: { columns: { id: true } } },
		orderBy: [desc(assets.currentValueMinor)],
	});
	const linked = await db
		.select({
			id: liabilities.id,
			name: liabilities.name,
			balance: liabilities.currentBalanceMinor,
			assetId: liabilities.linkedAssetId,
		})
		.from(liabilities)
		.where(and(eq(liabilities.userId, userId), eq(liabilities.isActive, true)));
	const byAsset = new Map(
		linked.filter((l) => l.assetId).map((l) => [l.assetId as string, l]),
	);
	return rows.map(({ valuations, ...a }) => ({
		...a,
		valuationCount: valuations.length,
		linkedLiabilityName: byAsset.get(a.id)?.name ?? null,
		linkedLiabilityBalanceMinor: byAsset.get(a.id)?.balance ?? null,
	}));
}

export async function getAsset(
	userId: string,
	id: string,
	tx: DbOrTx = db,
): Promise<Asset & { valuations: AssetValuation[] }> {
	const row = await tx.query.assets.findFirst({
		where: and(eq(assets.id, id), eq(assets.userId, userId)),
		with: { valuations: { orderBy: [asc(assetValuations.date)] } },
	});
	if (!row)
		throw new ORPCError("NOT_FOUND", { message: "Sachwert nicht gefunden" });
	return row;
}

export async function createAsset(
	userId: string,
	input: {
		name: string;
		category: Asset["category"];
		currency: string;
		acquisitionDate?: string | null;
		acquisitionCostMinor?: number | null;
		currentValueMinor: number;
		valuationDate?: string;
		valuationSource?: AssetValuation["source"];
		reference?: string | null;
		syncSource?: string | null;
		externalId?: string | null;
		section?: string | null;
		notes?: string | null;
	},
): Promise<Asset> {
	return db.transaction(async (tx) => {
		const valuationDate = input.valuationDate ?? todayIso();
		const [row] = await tx
			.insert(assets)
			.values({
				userId,
				name: input.name,
				category: input.category,
				currency: input.currency,
				acquisitionDate: input.acquisitionDate ?? null,
				acquisitionCostMinor: input.acquisitionCostMinor ?? null,
				currentValueMinor: input.currentValueMinor,
				valuationDate,
				reference: input.reference ?? null,
				syncSource: input.syncSource ?? null,
				externalId: input.externalId ?? null,
				section: input.section ?? null,
				notes: input.notes ?? null,
			})
			.returning();
		// The acquisition is the first point of the history when it is known and
		// predates the first valuation; the current value is always a point.
		if (
			input.acquisitionDate &&
			input.acquisitionCostMinor !== null &&
			input.acquisitionCostMinor !== undefined &&
			input.acquisitionDate < valuationDate
		) {
			await tx.insert(assetValuations).values({
				assetId: row.id,
				date: input.acquisitionDate,
				valueMinor: input.acquisitionCostMinor,
				source: "purchase",
			});
		}
		await tx.insert(assetValuations).values({
			assetId: row.id,
			date: valuationDate,
			valueMinor: input.currentValueMinor,
			source: input.valuationSource ?? "manual",
		});
		return row;
	});
}

export async function updateAsset(
	userId: string,
	input: { id: string } & Partial<
		Omit<
			Asset,
			| "id"
			| "userId"
			| "createdAt"
			| "updatedAt"
			| "currentValueMinor"
			| "valuationDate"
			| "currency"
		>
	>,
): Promise<Asset> {
	const { id, ...patch } = input;
	const [row] = await db
		.update(assets)
		.set(patch)
		.where(and(eq(assets.id, id), eq(assets.userId, userId)))
		.returning();
	if (!row)
		throw new ORPCError("NOT_FOUND", { message: "Sachwert nicht gefunden" });
	return row;
}

export async function deleteAsset(userId: string, id: string): Promise<void> {
	await db
		.delete(assets)
		.where(and(eq(assets.id, id), eq(assets.userId, userId)));
}

/** Add or replace the valuation on a date; the newest one becomes current. */
export async function addValuation(
	userId: string,
	input: {
		assetId: string;
		date: string;
		valueMinor: number;
		source?: AssetValuation["source"];
		notes?: string | null;
	},
	tx: DbOrTx = db,
): Promise<AssetValuation> {
	// History row and the denormalised copy on the asset must land together.
	if (tx === db) return db.transaction((t) => addValuation(userId, input, t));
	const asset = await getAsset(userId, input.assetId, tx);
	const [row] = await tx
		.insert(assetValuations)
		.values({
			assetId: asset.id,
			date: input.date,
			valueMinor: input.valueMinor,
			source: input.source ?? "manual",
			notes: input.notes ?? null,
		})
		.onConflictDoUpdate({
			target: [assetValuations.assetId, assetValuations.date],
			set: {
				valueMinor: input.valueMinor,
				source: input.source ?? "manual",
				notes: input.notes ?? null,
			},
		})
		.returning();
	await syncCurrentValue(asset.id, tx);
	return row;
}

export async function deleteValuation(
	userId: string,
	valuationId: string,
): Promise<void> {
	await db.transaction(async (tx) => {
		const val = await tx.query.assetValuations.findFirst({
			where: eq(assetValuations.id, valuationId),
		});
		if (!val) return;
		await getAsset(userId, val.assetId, tx);
		await tx.delete(assetValuations).where(eq(assetValuations.id, valuationId));
		await syncCurrentValue(val.assetId, tx);
	});
}

async function syncCurrentValue(assetId: string, tx: DbOrTx): Promise<void> {
	const latest = await tx.query.assetValuations.findFirst({
		where: eq(assetValuations.assetId, assetId),
		orderBy: [desc(assetValuations.date)],
	});
	// With the last valuation deleted the asset has no value any more. Leaving
	// the old copy on the parent would make the sheet contradict net worth,
	// which reads the history and drops the asset entirely.
	await tx
		.update(assets)
		.set(
			latest
				? { currentValueMinor: latest.valueMinor, valuationDate: latest.date }
				: { currentValueMinor: 0, valuationDate: null },
		)
		.where(eq(assets.id, assetId));
}
