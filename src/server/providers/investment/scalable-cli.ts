import { createHash } from "node:crypto";
import { parseDecimalToMinor } from "@/domain/money";

export class ScalableSnapshotError extends Error {}

type Obj = Record<string, unknown>;
const object = (value: unknown): Obj | null =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Obj)
		: null;
const string = (value: unknown): string | null =>
	typeof value === "string" && value.trim() ? value.trim() : null;
const money = (value: unknown): number | null => {
	const parsed =
		typeof value === "string" || typeof value === "number"
			? parseDecimalToMinor(value)
			: null;
	return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
};
const number = (value: unknown): number | null => {
	if (typeof value !== "string" && typeof value !== "number") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const timestamp = (value: unknown): Date | null => {
	const raw = string(value);
	const parsed = raw ? new Date(raw) : null;
	return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
};

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/** A holding's ISIN, name and quantity, or null when one of them is unusable. */
function holdingIdentity(row: Obj | null) {
	const isin = string(row?.isin)?.toUpperCase();
	const name = string(row?.name);
	const quantity = number(row?.quantity);
	if (!row || !isin || !ISIN.test(isin) || !name || quantity === null)
		return null;
	return { row, isin, name, quantity };
}

/**
 * What a snapshot left out, counted in Fortuna's own terms. One odd row must
 * not cost the whole depot: the account-level contract (envelope, identity,
 * lists) still rejects a snapshot, a single unusable row is skipped and
 * reported instead.
 */
export type ScalableSnapshotWarnings = {
	/** Holdings without a usable ISIN, name or quantity. */
	skippedHoldings: number;
	/** Later rows repeating an ISIN already taken from this snapshot. */
	duplicateHoldings: number;
	/** Bookings without a stable ID or time; they return once they have one. */
	skippedTransactions: number;
	/** Later rows repeating a booking ID with different content. */
	conflictingTransactions: number;
	/**
	 * How the overview total relates to its parts. `with_cash` is total =
	 * securities + crypto + cash, which reconciles once cash is taken out;
	 * `unreconciled` keeps Scalable's total and says so.
	 */
	reconciliation: ScalableReconciliation;
};

export type ScalableReconciliation =
	| "parts"
	| "with_cash"
	| "unreconciled"
	| "unchecked";

/**
 * Scalable's overview total against the parts it breaks out. Until 23.09.2026
 * it was securities plus crypto; since then it is more, and one snapshot
 * that did not add up cost the whole depot for two days.
 */
export function reconcileTotal(
	total: number | null,
	securities: number | null,
	crypto: number | null,
	cash: number | null,
): ScalableReconciliation {
	if (total === null || securities === null || crypto === null)
		return "unchecked";
	const gap = total - securities - crypto;
	if (Math.abs(gap) <= 1) return "parts";
	if (cash !== null && Math.abs(gap - cash) <= 1) return "with_cash";
	return "unreconciled";
}

function result(value: unknown, label: string) {
	const envelope = object(value);
	const projected = object(envelope?.result);
	if (!envelope || !projected)
		throw new ScalableSnapshotError(`${label}: invalid official CLI JSON`);
	return { envelope, projected };
}

export type ScalableCliBundle = {
	overview: unknown;
	holdings: unknown;
	cash: unknown;
	transactions: unknown[];
};

/** A single official holdings read, deliberately separate from booked snapshots. */
export function parseScalableHoldingsPulse(value: unknown) {
	const holdings = result(value, "holdings pulse");
	const accountId = string(holdings.envelope.account_id);
	const portfolioId = string(holdings.envelope.portfolio_id);
	if (!accountId || !portfolioId || !Array.isArray(holdings.projected.items))
		throw new ScalableSnapshotError(
			"Holdings pulse has no broker identity or items",
		);
	if (holdings.projected.items.length > 5000)
		throw new ScalableSnapshotError("Too many holdings in pulse");
	// Skip exactly what the booked snapshot skips, so the overlay compares
	// like with like.
	const seen = new Set<string>();
	const positions = holdings.projected.items.flatMap((item) => {
		const holding = holdingIdentity(object(item));
		if (!holding || seen.has(holding.isin)) return [];
		seen.add(holding.isin);
		const { row, isin, name, quantity } = holding;
		const currency = string(row.valuation_currency)?.toUpperCase() ?? "EUR";
		const quoteCurrency = string(row.quote_currency)?.toUpperCase() ?? currency;
		const quote = number(row.quote_mid_price);
		const quotedValueMinor =
			quote !== null && quoteCurrency === currency
				? Math.round(quantity * quote * 100)
				: null;
		const reportedValueMinor = money(row.valuation);
		const quoteAt = timestamp(row.quote_timestamp_utc);
		return [
			{
				isin,
				name,
				quantity,
				currency,
				quotedValueMinor,
				reportedValueMinor,
				quoteAt,
				quoteOutdated: row.quote_is_outdated === true,
			},
		];
	});
	return { accountId, portfolioId, positions };
}

export function parseScalableCliBundle(bundle: ScalableCliBundle) {
	const overview = result(bundle.overview, "overview");
	const holdings = result(bundle.holdings, "holdings");
	const cash = result(bundle.cash, "cash");
	const accountId = string(overview.envelope.account_id);
	const portfolioId = string(overview.envelope.portfolio_id);
	if (!accountId || !portfolioId)
		throw new ScalableSnapshotError("Missing broker identity");
	for (const part of [holdings, cash]) {
		if (
			string(part.envelope.account_id) !== accountId ||
			string(part.envelope.portfolio_id) !== portfolioId
		)
			throw new ScalableSnapshotError(
				"Broker accounts in snapshot do not match",
			);
	}
	const overviewValuation = object(overview.projected.valuation);
	const overviewTimes = object(overview.projected.timestamps);
	const reportedTotalMinor = money(overviewValuation?.total);
	const securitiesMinor = money(overviewValuation?.securities);
	const cryptoMinor = money(overviewValuation?.crypto);
	const cashBalanceMinor = money(cash.projected.cash_balance);
	const reconciliation = reconcileTotal(
		reportedTotalMinor,
		securitiesMinor,
		cryptoMinor,
		cashBalanceMinor,
	);
	// Fortuna counts broker cash on its own. A total that already contains it
	// would count it twice, so the depot value is then the parts without cash.
	const portfolioValueMinor =
		reconciliation === "with_cash" &&
		securitiesMinor !== null &&
		cryptoMinor !== null
			? securitiesMinor + cryptoMinor
			: reportedTotalMinor;
	const warnings: ScalableSnapshotWarnings = {
		skippedHoldings: 0,
		duplicateHoldings: 0,
		skippedTransactions: 0,
		conflictingTransactions: 0,
		reconciliation,
	};
	const portfolioValuationAt = timestamp(
		overviewTimes?.valuation_timestamp_utc,
	);
	const rawItems = holdings.projected.items;
	if (!Array.isArray(rawItems))
		throw new ScalableSnapshotError("Holdings list is missing");
	if (rawItems.length > 5000)
		throw new ScalableSnapshotError("Too many holdings");
	const seen = new Set<string>();
	const positions = rawItems.flatMap((item) => {
		const holding = holdingIdentity(object(item));
		if (!holding) {
			warnings.skippedHoldings++;
			return [];
		}
		// The first row wins; adding a repeat could count one position twice.
		if (seen.has(holding.isin)) {
			warnings.duplicateHoldings++;
			return [];
		}
		seen.add(holding.isin);
		const { row, isin, name, quantity } = holding;
		const valuationCurrency =
			string(row.valuation_currency)?.toUpperCase() ?? "EUR";
		const quoteCurrency =
			string(row.quote_currency)?.toUpperCase() ?? valuationCurrency;
		const quotePrice = number(row.quote_mid_price);
		const fifoPrice = number(row.fifo_price);
		const reportedValue = money(row.valuation);
		const quotedValue =
			quotePrice === null ? null : Math.round(quantity * quotePrice * 100);
		const costBasisMinor =
			fifoPrice !== null && quoteCurrency === valuationCurrency
				? Math.round(quantity * fifoPrice * 100)
				: null;
		const valueMinor =
			reportedValue ??
			(quoteCurrency === valuationCurrency ? quotedValue : null) ??
			costBasisMinor;
		const valuationSource =
			reportedValue !== null
				? "scalable_valuation"
				: quotedValue !== null && quoteCurrency === valuationCurrency
					? "scalable_quote"
					: costBasisMinor !== null
						? "scalable_fifo_cost"
						: "unavailable";
		const confidence =
			reportedValue !== null
				? "provider_reported"
				: valueMinor !== null
					? "estimated"
					: "unavailable";
		const valuationAt =
			reportedValue !== null
				? portfolioValuationAt
				: timestamp(row.quote_timestamp_utc);
		return [
			{
				externalId: isin,
				isin,
				instrumentName: name,
				quantity,
				currency: valuationCurrency,
				valueMinor,
				costBasisMinor,
				price: quotePrice,
				valuationAt,
				valuationSource,
				confidence:
					row.quote_is_outdated === true && reportedValue === null
						? "stale"
						: confidence,
				assetClass: string(row.security_type),
				raw: row,
			},
		];
	});
	// One odd row is skipped; a list where nothing is usable is a changed
	// format, and accepting it would wipe every stored position.
	if (rawItems.length > 0 && positions.length === 0)
		throw new ScalableSnapshotError("No usable holding in snapshot");
	const transactions: Array<{
		sourceId: string;
		fingerprint: string;
		occurredAt: Date;
		kind: string;
		status: string;
		instrumentName: string | null;
		isin: string | null;
		quantity: number | null;
		amountMinor: number;
		currency: string;
		raw: Obj;
	}> = [];
	const seenTransactions = new Map<string, string>();
	for (const [pageIndex, page] of bundle.transactions.entries()) {
		const part = result(page, `transactions page ${pageIndex + 1}`);
		if (
			string(part.envelope.account_id) !== accountId ||
			string(part.envelope.portfolio_id) !== portfolioId
		)
			throw new ScalableSnapshotError(
				"Transaction account does not match snapshot",
			);
		if (!Array.isArray(part.projected.items))
			throw new ScalableSnapshotError("Transaction items are missing");
		for (const item of part.projected.items) {
			const row = object(item);
			const sourceId = string(row?.id);
			const occurredAt = timestamp(row?.last_event_datetime);
			if (!row || !sourceId || !occurredAt) {
				warnings.skippedTransactions++;
				continue;
			}
			const type =
				`${string(row.security_transaction_type) ?? ""} ${string(row.cash_transaction_type) ?? ""} ${string(row.type) ?? ""} ${string(row.side) ?? ""}`.toLowerCase();
			const kind = /buy|kauf|purchase/.test(type)
				? "buy"
				: /sell|verkauf/.test(type)
					? "sell"
					: /dividend|distribution|ausschütt/.test(type)
						? "dividend"
						: /fee|gebühr/.test(type)
							? "fee"
							: /tax|steuer/.test(type)
								? "tax"
								: /deposit|einzahlung/.test(type)
									? "deposit"
									: /withdraw|auszahlung/.test(type)
										? "withdrawal"
										: /interest|zins/.test(type)
											? "interest"
											: "other";
			const amountMinor = money(row.amount) ?? 0;
			const currency = string(row.currency)?.toUpperCase() ?? "EUR";
			const fingerprint = createHash("sha256")
				.update(
					JSON.stringify([
						sourceId,
						occurredAt.toISOString(),
						kind,
						amountMinor,
						currency,
					]),
				)
				.digest("hex");
			// Pages are read one after another; a booking that moved on in
			// between appears twice. The first read is kept.
			const previous = seenTransactions.get(sourceId);
			if (previous && previous !== fingerprint)
				warnings.conflictingTransactions++;
			if (previous) continue;
			seenTransactions.set(sourceId, fingerprint);
			transactions.push({
				sourceId,
				fingerprint,
				occurredAt,
				kind,
				status: string(row.status) ?? "unknown",
				instrumentName: string(row.description),
				isin: string(row.isin)?.toUpperCase() ?? null,
				quantity: number(row.quantity),
				amountMinor,
				currency,
				raw: row,
			});
		}
	}
	return {
		accountId,
		portfolioId,
		currency: "EUR",
		portfolioValueMinor,
		cryptoValueMinor: cryptoMinor,
		portfolioValuationAt,
		cashBalanceMinor,
		cashValuationAt: portfolioValuationAt,
		positions,
		transactions,
		capabilities: ["holdings", "cash", "transactions", "portfolio_valuation"],
		warnings,
	};
}
