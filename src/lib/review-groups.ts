/**
 * Pure helpers for the batch review (`src/components/category-review.tsx`).
 * The rules they serve live in AGENTS.md: one decision per merchant and
 * direction, nothing written until the owner confirms.
 */

type ReviewRow = {
	id: string;
	merchantName: string | null;
	description: string;
	amountMinor: number;
};

export type MerchantGroup<R extends ReviewRow> = {
	key: string;
	label: string;
	rows: R[];
	sumMinor: number;
};

/**
 * Bookings from one merchant, in one direction, as a single decision.
 *
 * eBay alone had fifteen open bookings, which meant fifteen identical
 * dropdowns. They share a merchant, so they share the evidence and the
 * answer; the individual rows stay reachable for the odd one out. Largest
 * group first: that is where one tap files the most.
 */
export function groupByMerchant<R extends ReviewRow>(
	rows: readonly R[],
): MerchantGroup<R>[] {
	const groups = new Map<string, MerchantGroup<R>>();
	for (const row of rows) {
		const name = row.merchantName ?? row.description;
		const key = `${row.amountMinor < 0 ? "out" : "in"}|${name.toLowerCase()}`;
		const group = groups.get(key) ?? {
			key,
			label: name,
			rows: [],
			sumMinor: 0,
		};
		group.rows.push(row);
		group.sumMinor += row.amountMinor;
		groups.set(key, group);
	}
	return [...groups.values()].sort(
		(left, right) => right.rows.length - left.rows.length,
	);
}

/** The category every row of a group shares, or "" when they differ or none. */
export function sharedPick(
	rows: readonly { id: string }[],
	picks: Readonly<Record<string, string>>,
): string {
	const first = picks[rows[0]?.id ?? ""];
	if (!first) return "";
	return rows.every((row) => picks[row.id] === first) ? first : "";
}

/**
 * The picks that may be sent: only for bookings that are still open. A
 * booking confirmed with an earlier group, or filed elsewhere meanwhile,
 * drops out of the review — sending its old pick again would overwrite the
 * owner's later decision with a stale one.
 */
export function openPicks(
	picks: Readonly<Record<string, string>>,
	openIds: ReadonlySet<string>,
): { transactionId: string; categoryId: string }[] {
	return Object.entries(picks)
		.filter(([transactionId]) => openIds.has(transactionId))
		.map(([transactionId, categoryId]) => ({ transactionId, categoryId }));
}

/**
 * Pre-ticked proposals for bookings the review has not shown before. After
 * one group is confirmed the review reloads and further bookings move up;
 * their certain proposals are ticked like the first ones were, while a
 * booking the owner has already decided on keeps that decision.
 */
export function seedCertainPicks(
	certain: readonly {
		id: string;
		suggestion?: { categoryId: string } | null;
	}[],
	picks: Readonly<Record<string, string>>,
	seen: ReadonlySet<string>,
): Record<string, string> | null {
	let next: Record<string, string> | null = null;
	for (const row of certain) {
		if (seen.has(row.id) || !row.suggestion || picks[row.id]) continue;
		next ??= { ...picks };
		next[row.id] = row.suggestion.categoryId;
	}
	return next;
}
