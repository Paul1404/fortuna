import { addDays, type IsoDate } from "./dates";

/**
 * When a held booking the bank no longer reports may be let go.
 *
 * A bank reports a card payment as pending first and books it later. When the
 * booking keeps the reference or the content, the held row becomes it. When
 * both change — a new reference and a final amount — nothing links the two:
 * the booked row arrives as a new transaction and the held one stayed pending
 * for good, listed beside the booking that replaced it.
 *
 * The rule is deliberately narrow. A held row is only let go when
 *   - it came from this provider and is still pending (a booking is a fact
 *     and is never touched),
 *   - it is older than `PENDING_EXPIRY_DAYS`, so a hotel or rental hold that
 *     is genuinely still open has time to be reported again,
 *   - the read reached back past its date with the usual overlap, so its
 *     absence from the read means something,
 *   - the read delivered at least one booking on or after its date, so an
 *     empty or truncated answer never clears anything, and
 *   - the owner has not touched it (manual category or a note) and it is not
 *     one leg of a transfer.
 */
export const PENDING_EXPIRY_DAYS = 14;

/** Margin the read must reach before a held row's date to count as covering it. */
export const PENDING_COVER_MARGIN_DAYS = 7;

export type HeldRow = {
	id: string;
	bookingDate: IsoDate;
	externalId: string | null;
	fingerprint: string;
	transferGroupId: string | null;
	categorySource: string | null;
	notes: string | null;
};

export type ReportedRow = {
	bookingDate: IsoDate;
	externalId: string | null;
	fingerprint: string;
};

/** The oldest date a read must reach so every held row can be judged. */
export function pendingReadFrom(
	held: readonly Pick<HeldRow, "bookingDate">[],
): IsoDate | null {
	let oldest: IsoDate | null = null;
	for (const row of held)
		if (!oldest || row.bookingDate < oldest) oldest = row.bookingDate;
	return oldest ? addDays(oldest, -PENDING_COVER_MARGIN_DAYS) : null;
}

export function unreportedPendingIds(
	held: readonly HeldRow[],
	reported: readonly ReportedRow[],
	readFrom: IsoDate | null,
	today: IsoDate,
): string[] {
	if (!reported.length) return [];
	const externalIds = new Set(
		reported.flatMap((row) => (row.externalId ? [row.externalId] : [])),
	);
	const fingerprints = new Set(reported.map((row) => row.fingerprint));
	let newest: IsoDate | null = null;
	for (const row of reported)
		if (!newest || row.bookingDate > newest) newest = row.bookingDate;
	const cutoff = addDays(today, -PENDING_EXPIRY_DAYS);
	return held
		.filter(
			(row) =>
				row.bookingDate <= cutoff &&
				(!readFrom ||
					readFrom <= addDays(row.bookingDate, -PENDING_COVER_MARGIN_DAYS)) &&
				newest !== null &&
				newest >= row.bookingDate &&
				!(row.externalId && externalIds.has(row.externalId)) &&
				!fingerprints.has(row.fingerprint) &&
				!row.transferGroupId &&
				row.categorySource !== "manual" &&
				!row.notes?.trim(),
		)
		.map((row) => row.id);
}
