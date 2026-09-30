/** A broker can revise a transaction's event time or amount without changing its ID. */
export function classifyBrokerTransactionRevision(
	previous: {
		fingerprint: string;
		status: string;
		kind: string;
		isin: string | null;
		currency: string;
	},
	incoming: {
		fingerprint: string;
		status: string;
		kind: string;
		isin: string | null;
		currency: string;
	},
): "duplicate" | "revision" | "identity_conflict" {
	if (
		previous.kind !== incoming.kind ||
		previous.isin !== incoming.isin ||
		previous.currency !== incoming.currency
	)
		return "identity_conflict";
	return previous.fingerprint === incoming.fingerprint &&
		previous.status === incoming.status
		? "duplicate"
		: "revision";
}

/** Persist only a small SQLSTATE allowlist, never database or provider error text. */
export function classifyInvestmentSyncFailure(
	error: unknown,
):
	| "DB_CONSTRAINT_CONFLICT"
	| "DB_REFERENCE_CONFLICT"
	| "DB_REQUIRED_VALUE_MISSING"
	| "DB_AMOUNT_OUT_OF_RANGE"
	| "DB_SCHEMA_MISSING"
	| "SYNC_FAILED" {
	let current = error;
	for (let depth = 0; depth < 3; depth++) {
		if (!current || typeof current !== "object") break;
		const candidate = current as { code?: unknown; cause?: unknown };
		switch (candidate.code) {
			case "23505":
				return "DB_CONSTRAINT_CONFLICT";
			case "23503":
				return "DB_REFERENCE_CONFLICT";
			case "23502":
				return "DB_REQUIRED_VALUE_MISSING";
			case "22003":
				return "DB_AMOUNT_OUT_OF_RANGE";
			case "42P01":
				return "DB_SCHEMA_MISSING";
		}
		current = candidate.cause;
	}
	return "SYNC_FAILED";
}

/**
 * The CLI is the one supported source. A row from the removed CSV import or
 * the hosted MCP may still exist; it ranks below and is used only when no
 * CLI row of that provider is eligible.
 */
function methodRank(method: string): number {
	return method === "cli" ? 1 : 0;
}

/** Prefer the strongest valued snapshot per provider, retaining every portfolio at that tier. */
export function preferredSourceAccounts<
	T extends {
		id: string;
		provider: string;
		method: string;
		cashBalanceMinor: number | null;
		portfolioValueMinor: number | null;
	},
>(
	accounts: readonly T[],
	hasValuedPosition: (accountId: string) => boolean,
	hasAnyPosition: (accountId: string) => boolean = hasValuedPosition,
): T[] {
	const valued = accounts.filter(
		(account) =>
			account.cashBalanceMinor !== null ||
			account.portfolioValueMinor !== null ||
			hasValuedPosition(account.id),
	);
	const providersWithValue = new Set(valued.map((account) => account.provider));
	const eligible = [
		...valued,
		...accounts.filter(
			(account) =>
				!providersWithValue.has(account.provider) && hasAnyPosition(account.id),
		),
	];
	const bestByProvider = new Map<string, number>();
	for (const account of eligible) {
		const rank = methodRank(account.method);
		bestByProvider.set(
			account.provider,
			Math.max(bestByProvider.get(account.provider) ?? 0, rank),
		);
	}
	return eligible.filter(
		(account) =>
			methodRank(account.method) === bestByProvider.get(account.provider),
	);
}
