import { ORPCError } from "@orpc/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { DEFAULT_CATEGORIES } from "@/domain/default-categories";
import { slugify } from "@/domain/normalize";
import { type DbOrTx, db } from "@/server/db";
import { type Category, categories, transactions } from "@/server/db/schema";

export type CategoryWithUsage = Category & { transactionCount: number };

export async function listCategories(
	userId: string,
): Promise<CategoryWithUsage[]> {
	const rows = await db
		.select({
			category: categories,
			transactionCount: sql<number>`(select count(*)::int from ${transactions} t where t.category_id = "categories"."id")`,
		})
		.from(categories)
		.where(eq(categories.userId, userId))
		.orderBy(asc(categories.sortOrder), asc(categories.name));
	return rows.map((r) => ({
		...r.category,
		transactionCount: r.transactionCount,
	}));
}

export async function categoryMap(
	userId: string,
	tx: DbOrTx = db,
): Promise<Map<string, Category>> {
	const rows = await tx
		.select()
		.from(categories)
		.where(eq(categories.userId, userId));
	return new Map(rows.map((c) => [c.id, c]));
}

export async function findCategoryBySlug(
	userId: string,
	slug: string,
	tx: DbOrTx = db,
): Promise<Category | null> {
	const row = await tx.query.categories.findFirst({
		where: and(eq(categories.userId, userId), eq(categories.slug, slug)),
	});
	return row ?? null;
}

async function uniqueSlug(
	userId: string,
	base: string,
	tx: DbOrTx,
): Promise<string> {
	let slug = slugify(base) || "category";
	let n = 1;
	while (await findCategoryBySlug(userId, slug, tx)) {
		n += 1;
		slug = `${slugify(base)}-${n}`;
	}
	return slug;
}

export async function createCategory(
	userId: string,
	input: {
		name: string;
		kind?: Category["kind"];
		parentId?: string | null;
		icon?: string | null;
		color?: string | null;
	},
): Promise<Category> {
	return db.transaction(async (tx) => {
		if (input.parentId) {
			const parent = await tx.query.categories.findFirst({
				where: and(
					eq(categories.id, input.parentId),
					eq(categories.userId, userId),
				),
			});
			if (!parent)
				throw new ORPCError("NOT_FOUND", {
					message: "Übergeordnete Kategorie nicht gefunden",
				});
			if (parent.parentId)
				throw new ORPCError("BAD_REQUEST", {
					message: "Kategorien können nur eine Ebene tief verschachtelt werden",
				});
		}
		const [row] = await tx
			.insert(categories)
			.values({
				userId,
				name: input.name,
				slug: await uniqueSlug(userId, input.name, tx),
				kind: input.kind ?? "expense",
				parentId: input.parentId ?? null,
				icon: input.icon ?? null,
				color: input.color ?? null,
				sortOrder: 500,
			})
			.returning();
		return row;
	});
}

export async function updateCategory(
	userId: string,
	input: {
		id: string;
		name?: string;
		kind?: Category["kind"];
		parentId?: string | null;
		icon?: string | null;
		color?: string | null;
	},
): Promise<Category> {
	if (input.parentId === input.id)
		throw new ORPCError("BAD_REQUEST", {
			message: "Eine Kategorie kann nicht sich selbst übergeordnet sein",
		});
	return db.transaction(async (tx) => {
		const target = await tx.query.categories.findFirst({
			where: and(eq(categories.id, input.id), eq(categories.userId, userId)),
		});
		if (!target)
			throw new ORPCError("NOT_FOUND", {
				message: "Kategorie nicht gefunden",
			});
		if (input.parentId) {
			const [parent, child] = await Promise.all([
				tx.query.categories.findFirst({
					where: and(
						eq(categories.id, input.parentId),
						eq(categories.userId, userId),
					),
				}),
				tx.query.categories.findFirst({
					where: and(
						eq(categories.parentId, input.id),
						eq(categories.userId, userId),
					),
					columns: { id: true },
				}),
			]);
			if (!parent)
				throw new ORPCError("NOT_FOUND", {
					message: "Übergeordnete Kategorie nicht gefunden",
				});
			if (parent.parentId || child)
				throw new ORPCError("BAD_REQUEST", {
					message: "Kategorien können nur eine Ebene tief verschachtelt werden",
				});
		}
		const patch: Partial<typeof categories.$inferInsert> = {};
		if (input.name !== undefined) patch.name = input.name;
		if (input.kind !== undefined) patch.kind = input.kind;
		if (input.parentId !== undefined) patch.parentId = input.parentId;
		if (input.icon !== undefined) patch.icon = input.icon;
		if (input.color !== undefined) patch.color = input.color;
		const [row] = await tx
			.update(categories)
			.set(patch)
			.where(and(eq(categories.id, input.id), eq(categories.userId, userId)))
			.returning();
		return row;
	});
}

export async function deleteCategory(
	userId: string,
	id: string,
): Promise<void> {
	await db.transaction(async (tx) => {
		const target = await tx.query.categories.findFirst({
			where: and(eq(categories.id, id), eq(categories.userId, userId)),
		});
		if (!target)
			throw new ORPCError("NOT_FOUND", { message: "Kategorie nicht gefunden" });
		// Children move up to the deleted category's parent; transactions lose
		// their category (FK is set null) and can be re-categorised by rules.
		await tx
			.update(categories)
			.set({ parentId: target.parentId })
			.where(eq(categories.parentId, id));
		await tx.delete(categories).where(eq(categories.id, id));
	});
}

export async function ensureDefaultCategories(
	userId: string,
	tx: DbOrTx = db,
): Promise<void> {
	const existing = await tx
		.select({ id: categories.id })
		.from(categories)
		.where(eq(categories.userId, userId))
		.limit(1);
	if (existing.length > 0) return;
	let order = 0;
	for (const def of DEFAULT_CATEGORIES) {
		const [parent] = await tx
			.insert(categories)
			.values({
				userId,
				name: def.name,
				slug: def.slug,
				kind: def.kind,
				icon: def.icon,
				isSystem: true,
				sortOrder: order++,
			})
			.returning();
		for (const child of def.children ?? []) {
			await tx.insert(categories).values({
				userId,
				name: child.name,
				slug: child.slug,
				kind: def.kind,
				parentId: parent.id,
				icon: child.icon ?? null,
				isSystem: true,
				sortOrder: order++,
			});
		}
	}
}
