import { normalizeMerchantName } from "@/domain/normalize";
import { type DbOrTx, db } from "@/server/db";
import { merchants } from "@/server/db/schema";

export async function upsertMerchant(
	userId: string,
	name: string,
	tx: DbOrTx = db,
): Promise<{ id: string; name: string }> {
	const normalized = normalizeMerchantName(name);
	const [row] = await tx
		.insert(merchants)
		.values({ userId, name: name.trim(), normalizedName: normalized })
		.onConflictDoUpdate({
			target: [merchants.userId, merchants.normalizedName],
			set: { updatedAt: new Date() },
		})
		.returning({ id: merchants.id, name: merchants.name });
	return row;
}
