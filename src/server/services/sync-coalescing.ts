/**
 * One bank sync per connection at a time, whoever starts it.
 *
 * The owner's Abgleichen, the automatic sync on page load and the first read
 * inside the bank callback all read the same session and write the same
 * accounts. Run side by side they insert the same new account twice and spend
 * the bank's read allowance twice. Every caller goes through here: a second
 * caller joins the read already running instead of starting its own.
 *
 * In-process only, which is enough for a single-instance service.
 */
const activeSyncs = new Map<string, Promise<unknown>>();

function key(userId: string, connectionId: string) {
	return `${userId}:${connectionId}`;
}

export function isSyncing(userId: string, connectionId: string): boolean {
	return activeSyncs.has(key(userId, connectionId));
}

export function coalesceSync<T>(
	userId: string,
	connectionId: string,
	run: () => Promise<T>,
): Promise<T> {
	const syncKey = key(userId, connectionId);
	const active = activeSyncs.get(syncKey);
	if (active) return active as Promise<T>;
	const task = run().finally(() => {
		activeSyncs.delete(syncKey);
	});
	activeSyncs.set(syncKey, task);
	return task;
}
