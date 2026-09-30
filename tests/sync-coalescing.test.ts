import { describe, expect, it } from "vitest";
import { syncConnection } from "@/server/services/connections";
import { coalesceSync, isSyncing } from "@/server/services/sync-coalescing";

describe("one bank sync per connection", () => {
	it("joins a sync already running instead of starting another", async () => {
		let runs = 0;
		let release: (value: { imported: number }) => void = () => {};
		const run = () => {
			runs += 1;
			return new Promise<{ imported: number }>((resolve) => {
				release = resolve;
			});
		};
		const first = coalesceSync("u1", "c1", run);
		const second = coalesceSync("u1", "c1", run);
		expect(second).toBe(first);
		expect(runs).toBe(1);
		expect(isSyncing("u1", "c1")).toBe(true);
		release({ imported: 3 });
		await expect(first).resolves.toEqual({ imported: 3 });
		expect(isSyncing("u1", "c1")).toBe(false);
	});

	it("lets Abgleichen join the first read the bank callback started", async () => {
		// The callback's read runs through the same gate, so a manual or
		// automatic sync arriving meanwhile must not read the session again.
		let release: (value: unknown) => void = () => {};
		const callbackRead = coalesceSync(
			"u2",
			"c2",
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		// Joining never touches the database: the unit suite has none, so a
		// second read of its own would reject here.
		const manual = syncConnection("u2", "c2");
		const result = { accountsLinked: 1, imported: 0, duplicates: 0 };
		release(result);
		expect(await manual).toBe(result);
		expect(await callbackRead).toBe(result);
	});

	it("frees the connection when a sync fails", async () => {
		await expect(
			coalesceSync("u3", "c3", () => Promise.reject(new Error("boom"))),
		).rejects.toThrow("boom");
		expect(isSyncing("u3", "c3")).toBe(false);
	});
});
