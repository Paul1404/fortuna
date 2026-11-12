import { afterEach, describe, expect, it, vi } from "vitest";

const held = new Set<string>();
const waiting = new Map<string, (() => void)[]>();

vi.mock("@/server/db", () => ({
	pool: {
		connect: async () => ({
			query: async (statement: string, values: string[]) => {
				const key = values[0];
				if (statement.includes("pg_try_advisory_lock")) {
					if (held.has(key)) return { rows: [{ acquired: false }] };
					held.add(key);
					return { rows: [{ acquired: true }] };
				}
				if (statement.includes("pg_advisory_lock")) {
					if (held.has(key))
						await new Promise<void>((resolve) => {
							const queue = waiting.get(key) ?? [];
							queue.push(resolve);
							waiting.set(key, queue);
						});
					held.add(key);
					return { rows: [] };
				}
				if (statement.includes("pg_advisory_unlock")) {
					held.delete(key);
					waiting.get(key)?.shift()?.();
					return { rows: [{ pg_advisory_unlock: true }] };
				}
				return { rows: [] };
			},
			release: () => undefined,
		}),
	},
}));

const { CopilotOperationBusyError, withCopilotOperationLock } = await import(
	"@/server/services/copilot-operation-lock"
);

afterEach(() => {
	held.clear();
	waiting.clear();
});

describe("Copilot PostgreSQL operation lock", () => {
	it("rejects a simultaneous turn for the same user and permits another user", async () => {
		let release!: () => void;
		const first = withCopilotOperationLock(
			"owner",
			() => new Promise<void>((resolve) => (release = resolve)),
		);
		await vi.waitFor(() => expect(held.size).toBe(1));
		await expect(
			withCopilotOperationLock("owner", async () => undefined),
		).rejects.toBeInstanceOf(CopilotOperationBusyError);
		await expect(
			withCopilotOperationLock("another-owner", async () => "ok"),
		).resolves.toBe("ok");
		release();
		await first;
		await expect(
			withCopilotOperationLock("owner", async () => "released"),
		).resolves.toBe("released");
	});

	it("releases the lock when cancellation rejects the operation", async () => {
		const controller = new AbortController();
		const cancelled = withCopilotOperationLock(
			"owner",
			() =>
				new Promise<void>((_resolve, reject) => {
					controller.signal.addEventListener(
						"abort",
						() => reject(new Error("cancelled")),
						{ once: true },
					);
				}),
		);
		await vi.waitFor(() => expect(held.size).toBe(1));
		controller.abort();
		await expect(cancelled).rejects.toThrow("cancelled");
		await expect(
			withCopilotOperationLock("owner", async () => "next turn"),
		).resolves.toBe("next turn");
	});
});
