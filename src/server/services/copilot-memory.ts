import { ORPCError } from "@orpc/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { type CopilotMemory, copilotMemories } from "@/server/db/schema";

export async function listMemories(userId: string) {
	return db
		.select()
		.from(copilotMemories)
		.where(eq(copilotMemories.userId, userId))
		.orderBy(desc(copilotMemories.updatedAt))
		.limit(50);
}

export async function remember(
	userId: string,
	input: Pick<CopilotMemory, "key" | "kind" | "content">,
) {
	const [row] = await db
		.insert(copilotMemories)
		.values({ ...input, userId })
		.onConflictDoUpdate({
			target: [copilotMemories.userId, copilotMemories.key],
			set: {
				kind: input.kind,
				content: input.content,
				lastConfirmedAt: new Date(),
				updatedAt: new Date(),
			},
		})
		.returning();
	return row;
}

export async function updateMemory(
	userId: string,
	input: { id: string; content: string; kind?: CopilotMemory["kind"] },
) {
	const { id, ...patch } = input;
	const [row] = await db
		.update(copilotMemories)
		.set({ ...patch, lastConfirmedAt: new Date() })
		.where(and(eq(copilotMemories.id, id), eq(copilotMemories.userId, userId)))
		.returning();
	if (!row)
		throw new ORPCError("NOT_FOUND", { message: "Erinnerung nicht gefunden" });
	return row;
}

export async function forget(userId: string, id: string) {
	const [row] = await db
		.delete(copilotMemories)
		.where(and(eq(copilotMemories.id, id), eq(copilotMemories.userId, userId)))
		.returning({ id: copilotMemories.id });
	if (!row)
		throw new ORPCError("NOT_FOUND", { message: "Erinnerung nicht gefunden" });
	return row;
}
