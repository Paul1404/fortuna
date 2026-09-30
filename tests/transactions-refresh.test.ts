import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import { transactions } from "@/server/db/schema";
import { storedTextSaysNothing } from "@/server/services/transactions";

const mock = drizzle.mock();

describe("refreshing a placeholder booking text on re-read", () => {
	it("keeps the placeholder test inside the booking's own filter", () => {
		const { sql } = mock
			.update(transactions)
			.set({ description: "Rewe" })
			.where(
				and(
					eq(transactions.userId, "user"),
					eq(transactions.accountId, "account"),
					eq(transactions.externalId, "enable-banking:1"),
					storedTextSaysNothing(),
				),
			)
			.toSQL();
		const where = sql.slice(sql.indexOf(" where ") + 7);
		// Every alternative must sit inside one group that is ANDed with the
		// booking's identity. Unparenthesised, `... and x is null or y = ''`
		// matched every placeholder booking of every account and user.
		expect(where).toMatch(
			/"external_id" = \$\d+ and \("transactions"\."description" is null or .+\)\)$/,
		);
		const group = where.slice(where.indexOf('and ("transactions"'));
		let depth = 0;
		for (const [index, char] of [...group].entries()) {
			if (char === "(") depth += 1;
			if (char === ")") depth -= 1;
			if (group.startsWith(" or ", index)) expect(depth).toBeGreaterThan(0);
		}
	});
});
