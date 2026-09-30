// Text normalisation shared by dedupe, merchant matching and recurring
// detection. Kept deterministic and dependency-free.

const NOISE_PATTERNS: RegExp[] = [
	/\b(sepa|lastschrift|gutschrift|ueberweisung|überweisung|dauerauftrag|kartenzahlung|card payment|direct debit|transfer)\b/gi,
	/\b(end-to-end|eref|mref|cred|svwz|kref|iban|bic)\s*[:=]?\s*\S+/gi,
	/\b\d{2}[./-]\d{2}[./-]\d{2,4}\b/g, // dates
	/\b\d{2}:\d{2}(:\d{2})?\b/g, // times
	/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, // IBANs
	/\b\d{6,}\b/g, // long numeric references
	/[*#]+/g,
];

export function normalizeDescription(input: string): string {
	let s = input.toLowerCase();
	for (const p of NOISE_PATTERNS) s = s.replace(p, " ");
	s = s.replace(/[^\p{L}\p{N} ]+/gu, " ");
	return s.replace(/\s+/g, " ").trim();
}

/** Stable key for grouping transactions by counterparty. */
export function merchantKey(
	name: string | null | undefined,
	description: string,
): string {
	const base = name?.trim() ? name : description;
	const normalized = normalizeDescription(base);
	// The first three tokens carry the identity of almost every merchant string
	// ("rewe city 1234" -> "rewe city", "amazon eu sarl" -> "amazon eu sarl").
	return normalized
		.split(" ")
		.filter((token) => token && !/^\d+$/.test(token))
		.slice(0, 3)
		.join(" ");
}

export function normalizeMerchantName(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function titleCase(value: string): string {
	return value
		.split(" ")
		.map((w) =>
			w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase(),
		)
		.join(" ");
}

export function slugify(value: string): string {
	return value
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * A readable name for an account a provider created.
 *
 * Banks answer `name` with the account holder, not the account: all three of
 * this owner's connected accounts came back as "Alex Beispiel", which is useless
 * beside each other and worse beside a giro account of the same name. The
 * institution is the one field that is reliably about the account, so it is
 * the base, and the product or account type is only added when it is needed to
 * tell two accounts apart.
 */
export function providerAccountName(input: {
	institution: string;
	/** What the provider calls the product, e.g. "Girokonto". Often absent. */
	product?: string | null;
	/** German label for the account type, used when a product is missing. */
	typeLabel?: string | null;
	/** The account's IBAN or other reference, for a last resort. */
	reference?: string | null;
	/** Names already in use for this owner. */
	taken: ReadonlySet<string>;
}): string {
	const institution = input.institution.trim();
	const candidates = [
		institution,
		// A product that merely repeats the institution adds nothing.
		input.product?.trim() &&
		input.product.trim().toLowerCase() !== institution.toLowerCase()
			? `${institution} · ${input.product.trim()}`
			: null,
		input.typeLabel ? `${institution} · ${input.typeLabel}` : null,
		input.reference
			? `${institution} · …${input.reference.trim().slice(-4)}`
			: null,
	].filter((value): value is string => Boolean(value));
	for (const candidate of candidates)
		if (!input.taken.has(candidate)) return candidate;
	// Everything is taken, so number it rather than collide.
	for (let suffix = 2; suffix < 50; suffix += 1) {
		const candidate = `${institution} ${suffix}`;
		if (!input.taken.has(candidate)) return candidate;
	}
	return institution;
}

/**
 * A booking text that says nothing, and must never become a merchant.
 *
 * Banks answer with the ISO domain code ("PMNT"), with the account holder's own
 * name, or with nothing at all. Deriving a merchant from such a text groups
 * unrelated bookings under an invented merchant, and the categorisation review
 * would then conclude "all 3 earlier bookings from X are Y" about a merchant
 * that does not exist.
 */
export function isEmptyBookingText(value: string | null | undefined): boolean {
	const trimmed = value?.trim();
	if (!trimmed) return true;
	if (/^[A-Z]{4}$/.test(trimmed)) return true;
	return ["ohne verwendungszweck", "banktransaktion"].includes(
		trimmed.toLowerCase(),
	);
}

/**
 * Whether a booking says who it is with: a merchant, a counterparty, or a
 * text that is more than a placeholder. Anything that groups bookings by
 * merchant must skip the ones that do not, or unrelated bookings share the
 * invented merchant "Ohne Verwendungszweck".
 */
export function namesCounterparty(
	merchantName: string | null | undefined,
	counterpartyName: string | null | undefined,
	description: string,
): boolean {
	return Boolean(
		merchantName?.trim() ||
			counterpartyName?.trim() ||
			!isEmptyBookingText(description),
	);
}
