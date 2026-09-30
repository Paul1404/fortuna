/**
 * The arithmetic behind the quick actions on a receivable, a liability and a
 * cash wallet. Every one of them ends in a dated balance observation written
 * through the history services; these functions only decide which balance
 * that is and whether the date is one the history can take.
 */

export type PaymentPreview = {
	/** What is still open after the payment; never below zero. */
	remainingMinor: number;
	/** How much the payment exceeds the open amount. */
	overpaidMinor: number;
	/** The payment closes the balance. */
	settles: boolean;
};

/** The balance left after a repayment of `paymentMinor` against `balanceMinor`. */
export function previewPayment(
	balanceMinor: number,
	paymentMinor: number,
): PaymentPreview {
	const open = Math.max(0, balanceMinor);
	const payment = Math.max(0, paymentMinor);
	const remainingMinor = Math.max(0, open - payment);
	return {
		remainingMinor,
		overpaidMinor: Math.max(0, payment - open),
		settles: remainingMinor === 0,
	};
}

/**
 * Why a balance cannot be recorded on `date`, or null when it can. A date
 * before the newest observation would land in the past of the history and
 * leave today's balance where it was, so the owner's "paid back" would
 * silently change nothing.
 */
export function balanceDateProblem(
	date: string,
	{ balanceAsOf, today }: { balanceAsOf: string | null; today: string },
): string | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Datum eingeben";
	if (date > today) return "Das Datum liegt in der Zukunft";
	if (balanceAsOf && date < balanceAsOf)
		return "Das Datum liegt vor dem letzten Stand";
	return null;
}

/** The share of the original amount already repaid, 0 to 1, or null without one. */
export function repaidShare(
	originalMinor: number | null,
	balanceMinor: number,
): number | null {
	if (originalMinor === null || originalMinor <= 0) return null;
	return Math.min(
		1,
		Math.max(0, (originalMinor - balanceMinor) / originalMinor),
	);
}

export type RepaymentSplit = {
	/** The estimated interest in this month's rate. */
	interestMinor: number;
	/** The part of the rate that lowers the balance. */
	principalMinor: number;
};

/**
 * Splits one monthly rate of an annuity loan into interest and repayment.
 * Only the repayment lowers the balance: taking the whole rate off a
 * mortgage would count the bank's interest as debt paid. Interest is the
 * balance times a twelfth of the annual rate, rounded to the cent; without
 * a rate the whole payment counts as repayment.
 */
export function splitRate(
	balanceMinor: number,
	rateMinor: number,
	interestRateBps: number | null,
): RepaymentSplit {
	const balance = Math.max(0, balanceMinor);
	const rate = Math.max(0, rateMinor);
	const interestMinor =
		interestRateBps && interestRateBps > 0
			? Math.min(rate, Math.round((balance * interestRateBps) / 10_000 / 12))
			: 0;
	return {
		interestMinor,
		principalMinor: Math.min(balance, rate - interestMinor),
	};
}

/**
 * A prefilled amount as the owner would type it: decimal comma, no
 * grouping, empty for nothing. "291.97" in a German form reads as a
 * thousands separator.
 */
export function amountInputText(minor: number | null | undefined): string {
	if (minor === null || minor === undefined) return "";
	const abs = Math.abs(minor);
	return `${minor < 0 ? "-" : ""}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Open items first, the settled ones apart, each in the given order. */
export function splitSettled<T extends { isActive: boolean }>(
	rows: readonly T[],
): { open: T[]; settled: T[] } {
	return {
		open: rows.filter((row) => row.isActive),
		settled: rows.filter((row) => !row.isActive),
	};
}

/**
 * The booking text for a cash entry. The owner may leave the note empty; a
 * booking still needs a text, so it falls back to the category and then to
 * the direction.
 */
export function cashDescription(
	note: string | null | undefined,
	categoryName: string | null | undefined,
	direction: "outflow" | "inflow",
): string {
	const text = note?.trim();
	if (text) return text;
	const category = categoryName?.trim();
	if (category) return category;
	return direction === "outflow" ? "Barausgabe" : "Bareinnahme";
}
