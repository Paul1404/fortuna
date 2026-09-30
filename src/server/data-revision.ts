const revisions = new Map<string, number>();

export function dataRevision(userId: string) {
	return revisions.get(userId) ?? 0;
}

export function markDataChanged(userId: string) {
	const next = dataRevision(userId) + 1;
	revisions.set(userId, next);
	return next;
}
