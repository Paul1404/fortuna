import { ORPCError } from "@orpc/server";
import { and, asc, eq } from "drizzle-orm";
import type { Rule } from "@/domain/rules";
import { type DbOrTx, db } from "@/server/db";
import {
	type CategorizationRule,
	categories,
	categorizationRules,
} from "@/server/db/schema";

export async function listRules(userId: string): Promise<CategorizationRule[]> {
	return db
		.select()
		.from(categorizationRules)
		.where(eq(categorizationRules.userId, userId))
		.orderBy(
			asc(categorizationRules.priority),
			asc(categorizationRules.createdAt),
		);
}

export async function loadRules(
	userId: string,
	tx: DbOrTx = db,
): Promise<Rule[]> {
	const rows = await tx
		.select()
		.from(categorizationRules)
		.where(
			and(
				eq(categorizationRules.userId, userId),
				eq(categorizationRules.isActive, true),
			),
		);
	return rows.map(toDomainRule);
}

export function toDomainRule(r: CategorizationRule): Rule {
	return {
		id: r.id,
		priority: r.priority,
		isActive: r.isActive,
		descriptionContains: r.descriptionContains,
		merchantContains: r.merchantContains,
		counterpartyIban: r.counterpartyIban,
		amountMinMinor: r.amountMinMinor,
		amountMaxMinor: r.amountMaxMinor,
		accountId: r.accountId,
		direction: r.direction,
		categoryId: r.categoryId,
		setMerchantName: r.setMerchantName,
	};
}

type RuleInput = Omit<
	typeof categorizationRules.$inferInsert,
	"id" | "userId" | "createdAt" | "updatedAt" | "matchCount"
>;

async function assertCategory(userId: string, categoryId: string, tx: DbOrTx) {
	const cat = await tx.query.categories.findFirst({
		where: and(eq(categories.id, categoryId), eq(categories.userId, userId)),
	});
	if (!cat)
		throw new ORPCError("NOT_FOUND", { message: "Kategorie nicht gefunden" });
}

export async function createRule(
	userId: string,
	input: RuleInput,
): Promise<CategorizationRule> {
	await assertCategory(userId, input.categoryId, db);
	const [row] = await db
		.insert(categorizationRules)
		.values({ ...input, userId })
		.returning();
	return row;
}

export async function updateRule(
	userId: string,
	input: { id: string } & Partial<RuleInput>,
): Promise<CategorizationRule> {
	const { id, ...patch } = input;
	if (patch.categoryId) await assertCategory(userId, patch.categoryId, db);
	const [row] = await db
		.update(categorizationRules)
		.set(patch)
		.where(
			and(
				eq(categorizationRules.id, id),
				eq(categorizationRules.userId, userId),
			),
		)
		.returning();
	if (!row)
		throw new ORPCError("NOT_FOUND", { message: "Regel nicht gefunden" });
	return row;
}

export async function deleteRule(userId: string, id: string): Promise<void> {
	await db
		.delete(categorizationRules)
		.where(
			and(
				eq(categorizationRules.id, id),
				eq(categorizationRules.userId, userId),
			),
		);
}
