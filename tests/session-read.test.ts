import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { type ORPCContext, sessionRead } from "@/server/orpc/base";

const procedure = sessionRead.handler(({ context }) => context.user.id);
const context = (principal: ORPCContext["principal"]): ORPCContext => ({
	user: { id: "owner", email: "owner@example.test", name: "Owner" },
	headers: new Headers(),
	requestId: "test",
	principal,
});

describe("session-only provider read boundary", () => {
	it("allows the owner browser session", async () => {
		const client = createRouterClient(procedure, {
			context: context("session"),
		});
		expect(await client()).toBe("owner");
	});
	it("rejects the read-only MCP principal before invoking provider work", async () => {
		const client = createRouterClient(procedure, { context: context("mcp") });
		await expect(client()).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});
