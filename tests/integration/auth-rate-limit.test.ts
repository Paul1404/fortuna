import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { auth } from "@/server/auth";
import { pool } from "@/server/db";

const d =
	process.env.FORTUNA_INTEGRATION_TEST === "1" ? describe : describe.skip;

d("database-backed authentication limits", () => {
	afterAll(() => pool.end());
	it("limits repeated sign-ins using shared database counters", async () => {
		const fakeIp = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;
		const email = `${randomUUID()}@example.invalid`;
		const statuses: number[] = [];
		for (let attempt = 0; attempt < 9; attempt++) {
			const response = await auth.handler(
				new Request("http://localhost:3000/api/auth/sign-in/email", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						origin: "http://localhost:3000",
						"x-forwarded-for": fakeIp,
					},
					body: JSON.stringify({ email, password: "not-a-real-password" }),
				}),
			);
			statuses.push(response.status);
		}
		expect(statuses.slice(0, 8)).toEqual(Array(8).fill(401));
		expect(statuses[8]).toBe(429);
		const rows = await pool.query(
			"select count(*)::int as count from rate_limit",
		);
		expect(rows.rows[0]?.count).toBeGreaterThan(0);
	});
});
