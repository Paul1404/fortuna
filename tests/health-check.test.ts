import { afterEach, describe, expect, it, vi } from "vitest";
import { createHealthCheck, type StorageMode } from "@/server/health-check";

function probes(mode: StorageMode = "object_storage") {
	return {
		database: vi.fn(async () => ({ db: true, schema: true })),
		storageMode: () => mode,
		storage: vi.fn(async () => true),
	};
}

afterEach(() => vi.useRealTimers());

describe("deployment readiness", () => {
	it("requires the database, schema and configured storage to work", async () => {
		const dependencies = probes();
		expect(await createHealthCheck(dependencies, "test")()).toMatchObject({
			ok: true,
			db: true,
			schema: true,
			objectStorage: true,
		});
		dependencies.storage.mockResolvedValue(false);
		expect(await createHealthCheck(dependencies, "test")()).toMatchObject({
			ok: false,
			db: true,
			schema: true,
			objectStorage: false,
		});
		dependencies.storage.mockResolvedValue(true);
		dependencies.database.mockResolvedValue({ db: true, schema: false });
		expect(await createHealthCheck(dependencies, "test")()).toMatchObject({
			ok: false,
			db: true,
			schema: false,
		});
	});

	it("supports the intentional encrypted-database fallback without touching storage", async () => {
		const dependencies = probes("database");
		expect(await createHealthCheck(dependencies, "test")()).toMatchObject({
			ok: true,
			storageMode: "database",
			objectStorage: null,
		});
		expect(dependencies.storage).not.toHaveBeenCalled();
	});

	it("fails partial storage configuration without hiding it behind the fallback", async () => {
		const dependencies = probes("invalid");
		expect(await createHealthCheck(dependencies, "test")()).toMatchObject({
			ok: false,
			storageMode: "invalid",
			objectStorage: false,
		});
		expect(dependencies.storage).not.toHaveBeenCalled();
	});

	it("never returns database or provider error text", async () => {
		const dependencies = probes();
		dependencies.database.mockRejectedValue(
			new Error("private connection details"),
		);
		dependencies.storage.mockRejectedValue(
			new Error("private provider response"),
		);
		const body = await createHealthCheck(dependencies, "test")();
		expect(body).toMatchObject({
			ok: false,
			db: false,
			schema: false,
			objectStorage: false,
		});
		expect(JSON.stringify(body)).not.toContain("private");
	});

	it("returns a bounded failure when dependencies never settle", async () => {
		vi.useFakeTimers();
		const dependencies = probes();
		dependencies.database.mockImplementation(() => new Promise(() => {}));
		dependencies.storage.mockImplementation(() => new Promise(() => {}));
		const pending = createHealthCheck(dependencies, "test", {
			timeoutMs: 100,
		})();
		await vi.advanceTimersByTimeAsync(100);
		expect(await pending).toMatchObject({
			ok: false,
			db: false,
			schema: false,
			objectStorage: false,
		});
	});

	it("coalesces concurrent probes, caches briefly, and recovers promptly after failure", async () => {
		vi.useFakeTimers();
		const dependencies = probes();
		const check = createHealthCheck(dependencies, "test");
		await Promise.all([check(), check(), check()]);
		expect(dependencies.database).toHaveBeenCalledTimes(1);
		await check();
		expect(dependencies.storage).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(5_000);
		dependencies.storage.mockResolvedValue(false);
		expect((await check()).ok).toBe(false);
		dependencies.storage.mockResolvedValue(true);
		await vi.advanceTimersByTimeAsync(1_000);
		expect((await check()).ok).toBe(true);
	});
});
