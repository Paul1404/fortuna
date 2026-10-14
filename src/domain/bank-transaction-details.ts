/** Selected bank fields, never a stored raw provider response. */
export type BankTransactionDetails = Partial<
	Record<
		| "purpose"
		| "note"
		| "reference"
		| "bankText"
		| "ultimateCounterparty"
		| "transactionDate"
		| "merchantCategoryCode",
		string
	>
>;

export function bankTransactionDetails(
	row: Record<string, unknown>,
): BankTransactionDetails {
	const clean = (value: unknown): string | undefined =>
		typeof value === "string" && value.trim()
			? value.trim().slice(0, 2000)
			: undefined;
	const object = (value: unknown): Record<string, unknown> =>
		value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	const ultimate =
		row.credit_debit_indicator === "CRDT"
			? row.ultimate_debtor
			: row.ultimate_creditor;
	const fields = {
		purpose: clean(
			Array.isArray(row.remittance_information)
				? row.remittance_information
						.filter((v) => typeof v === "string")
						.join(" · ")
				: row.remittance_information,
		),
		note: clean(row.note),
		reference: clean(row.reference_number),
		bankText: clean(object(row.bank_transaction_code).description),
		ultimateCounterparty: clean(object(ultimate).name),
		transactionDate: clean(row.transaction_date),
		merchantCategoryCode: clean(row.merchant_category_code),
	};
	return Object.fromEntries(
		Object.entries(fields).filter(([, value]) => value !== undefined),
	);
}

export const BANK_DETAIL_LABELS: Record<keyof BankTransactionDetails, string> =
	{
		purpose: "Verwendungszweck",
		note: "Bankhinweis",
		reference: "Referenz",
		bankText: "Buchungsart",
		ultimateCounterparty: "Zahlungspartner",
		transactionDate: "Zahlungsdatum",
		merchantCategoryCode: "Händlercode",
	};
