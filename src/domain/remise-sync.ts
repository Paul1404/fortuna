export type RemiseSnapshotItem = {
	slug: string;
	sku: string;
	title: string;
	lifecycle:
		| "preparing"
		| "ready-for-import"
		| "imported-draft"
		| "ready-to-publish"
		| "published"
		| "reserved"
		| "sold"
		| "cancelled"
		| "archived";
	quantity: number;
	valuation: number | null;
	valuationBasis: "target-price" | "asking-price" | "unpriced";
	acquisitionCost: number | null;
	updatedAt: string;
};

const inactiveStates = new Set(["sold", "cancelled", "archived"]);

export function isActiveRemiseItem(item: RemiseSnapshotItem): boolean {
	return !inactiveStates.has(item.lifecycle);
}

export function remiseValueMinor(item: RemiseSnapshotItem): number | null {
	if (item.valuation === null) return null;
	return Math.round(item.valuation * 100) * item.quantity;
}

export function remiseAcquisitionCostMinor(
	item: RemiseSnapshotItem,
): number | null {
	if (item.acquisitionCost === null) return null;
	return Math.round(item.acquisitionCost * 100) * item.quantity;
}

export function remiseValuationNote(item: RemiseSnapshotItem): string {
	return item.valuationBasis === "target-price"
		? "Automatisch aus Remise, bewertet zum Zielpreis"
		: "Automatisch aus Remise, bewertet zum Angebotspreis";
}

export type RemiseMatchCandidate = { id: string; name: string };

function titleTokens(value: string): Set<string> {
	return new Set(
		value
			.toLocaleLowerCase("de")
			.replace(/ä/gu, "ae")
			.replace(/ö/gu, "oe")
			.replace(/ü/gu, "ue")
			.replace(/ß/gu, "ss")
			.split(/[^a-z0-9]+/u)
			.filter((token) => token.length >= 2),
	);
}

function matchScore(source: Set<string>, candidate: Set<string>): number {
	const shared = [...source].filter((token) => candidate.has(token));
	if (shared.length < 4) return 0;
	const containment = shared.length / Math.min(source.size, candidate.size);
	const strongIdentity = shared.some(
		(token) => token.length >= 4 && /\d/u.test(token),
	);
	if (!strongIdentity && containment < 0.85) return 0;
	return containment + (strongIdentity ? 0.5 : 0);
}

/**
 * Match only an unambiguous existing asset. A model/reference token or a near
 * complete title containment is required, so related generic stock does not
 * get merged merely because it shares a brand or product class.
 */
export function findRemiseAssetMatch(
	item: Pick<RemiseSnapshotItem, "title">,
	candidates: RemiseMatchCandidate[],
): string | null {
	const source = titleTokens(item.title);
	const ranked = candidates
		.map((candidate) => ({
			id: candidate.id,
			score: matchScore(source, titleTokens(candidate.name)),
		}))
		.filter((candidate) => candidate.score > 0)
		.sort((left, right) => right.score - left.score);
	const best = ranked[0];
	if (!best || best.score < 0.85) return null;
	if (ranked[1] && best.score - ranked[1].score < 0.15) return null;
	return best.id;
}
