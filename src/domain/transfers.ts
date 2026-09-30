import { daysBetween } from "./dates";

// Internal transfer detection: an outflow on one own account matched by an
// inflow of the same amount on another own account within a few days. Both
// legs get the same transfer group so cashflow can exclude them.

export type TransferCandidate = {
	id: string;
	accountId: string;
	bookingDate: string;
	amountMinor: number;
	currency: string;
	counterpartyIban?: string | null;
	transferGroupId?: string | null;
};

export type TransferPair = { outflowId: string; inflowId: string };

export function detectInternalTransfers(
	txs: readonly TransferCandidate[],
	ownIbans: ReadonlySet<string>,
	maxDays = 3,
): TransferPair[] {
	const pairs: TransferPair[] = [];
	const used = new Set<string>();
	const outflows = txs.filter((t) => t.amountMinor < 0 && !t.transferGroupId);
	const inflows = txs.filter((t) => t.amountMinor > 0 && !t.transferGroupId);
	const byAmount = new Map<string, TransferCandidate[]>();
	for (const inflow of inflows) {
		const key = `${inflow.currency}|${inflow.amountMinor}`;
		const list = byAmount.get(key) ?? [];
		list.push(inflow);
		byAmount.set(key, list);
	}
	for (const out of outflows) {
		if (used.has(out.id)) continue;
		const candidates =
			byAmount.get(`${out.currency}|${-out.amountMinor}`) ?? [];
		let best: TransferCandidate | null = null;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (const inflow of candidates) {
			if (used.has(inflow.id) || inflow.accountId === out.accountId) continue;
			const distance = Math.abs(
				daysBetween(out.bookingDate, inflow.bookingDate),
			);
			if (distance > maxDays) continue;
			// Prefer a counterparty IBAN that is one of our own accounts.
			const ibanHint =
				(out.counterpartyIban &&
					ownIbans.has(normalizeIban(out.counterpartyIban))) ||
				(inflow.counterpartyIban &&
					ownIbans.has(normalizeIban(inflow.counterpartyIban)));
			const score = distance - (ibanHint ? 0.5 : 0);
			if (score < bestDistance) {
				best = inflow;
				bestDistance = score;
			}
		}
		if (best) {
			used.add(out.id);
			used.add(best.id);
			pairs.push({ outflowId: out.id, inflowId: best.id });
		}
	}
	return pairs;
}

export function normalizeIban(iban: string): string {
	return iban.replace(/\s/g, "").toUpperCase();
}

/**
 * Pairs a bank debit to PayPal with the PayPal payment it funded.
 *
 * PayPal does not report the incoming side over PSD2: its account shows only
 * payments going out. The bank's "PayPal" debit and PayPal's payment to the
 * merchant are therefore the same money seen twice, and both counted as
 * spending — a purchase of 1.079 € showed up as 2.158 € of expenses.
 *
 * This is genuinely a transfer: money left the bank account for PayPal, and
 * PayPal paid the merchant. The PayPal leg is the one that names the merchant,
 * so it stays as the expense and the bank leg is what has to stop counting.
 * Both legs are outflows, which is why the ordinary transfer detection — built
 * on an outflow matched by an inflow — cannot see this pairing.
 */
export type FundingCandidate = {
	id: string;
	bookingDate: string;
	amountMinor: number;
	currency: string;
};

export type FundingPair = { bankId: string; paypalId: string };

export function matchPaypalFunding(
	bank: readonly FundingCandidate[],
	paypal: readonly FundingCandidate[],
	maxDays = 6,
): FundingPair[] {
	const pairs: FundingPair[] = [];
	const used = new Set<string>();
	// Oldest first, so an amount that repeats is matched in the order it
	// happened rather than by whichever row the database returned first.
	const sorted = [...paypal].sort((left, right) =>
		left.bookingDate.localeCompare(right.bookingDate),
	);
	for (const payment of sorted) {
		if (payment.amountMinor >= 0) continue;
		let best: FundingCandidate | null = null;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (const debit of bank) {
			if (used.has(debit.id)) continue;
			if (debit.amountMinor !== payment.amountMinor) continue;
			if (debit.currency !== payment.currency) continue;
			// The bank is charged after PayPal pays, never before.
			const distance = daysBetween(payment.bookingDate, debit.bookingDate);
			if (distance < 0 || distance > maxDays) continue;
			if (distance < bestDistance) {
				best = debit;
				bestDistance = distance;
			}
		}
		if (best) {
			used.add(best.id);
			pairs.push({ bankId: best.id, paypalId: payment.id });
		}
	}
	return pairs;
}
