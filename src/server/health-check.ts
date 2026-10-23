export type StorageMode = "database" | "object_storage" | "invalid";
export type HealthBody = {
	ok: boolean;
	db: boolean;
	schema: boolean;
	objectStorage: boolean | null;
	storageMode: StorageMode;
	version: string;
	latencyMs: number;
};

type Probes = {
	database: () => Promise<{ db: boolean; schema: boolean }>;
	storageMode: () => StorageMode;
	storage: () => Promise<boolean>;
};

/** Readiness is bounded and coalesced; a probe never calls a bank or a model. */
export function createHealthCheck(
	probes: Probes,
	version: string,
	{ timeoutMs = 5_000, cacheMs = 5_000 } = {},
) {
	let cached: { body: HealthBody; until: number } | undefined;
	let running: Promise<HealthBody> | undefined;

	async function bounded<T>(probe: () => Promise<T>, fallback: T): Promise<T> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				Promise.resolve().then(probe),
				new Promise<T>((resolve) => {
					timer = setTimeout(() => resolve(fallback), timeoutMs);
				}),
			]);
		} catch {
			return fallback;
		} finally {
			clearTimeout(timer);
		}
	}

	return function healthCheck(): Promise<HealthBody> {
		if (cached && cached.until > Date.now())
			return Promise.resolve(cached.body);
		if (running) return running;
		running = (async () => {
			const started = performance.now();
			const storageMode = probes.storageMode();
			const [database, objectStorage] = await Promise.all([
				bounded(probes.database, { db: false, schema: false }),
				storageMode === "database"
					? Promise.resolve(null)
					: storageMode === "invalid"
						? Promise.resolve(false)
						: bounded(probes.storage, false),
			]);
			const body: HealthBody = {
				ok:
					database.db &&
					database.schema &&
					(storageMode === "database" || objectStorage === true),
				...database,
				objectStorage,
				storageMode,
				version,
				latencyMs: Math.round(performance.now() - started),
			};
			cached = {
				body,
				until: Date.now() + (body.ok ? cacheMs : Math.min(cacheMs, 1_000)),
			};
			return body;
		})().finally(() => {
			running = undefined;
		});
		return running;
	};
}
