import { addDays, addMonths, endOfMonth, startOfMonth } from "@/domain/dates";

/** The Transaktionen page's URL state. The router validates it. */
export type TransactionSearch = {
	accountId?: string;
	categoryId?: string;
	merchantId?: string;
	recurringPaymentId?: string;
	q?: string;
	from?: string;
	to?: string;
	direction?: "inflow" | "outflow";
	uncategorised?: boolean;
	transfers?: "hide";
	page?: number;
	brokerPage?: number;
	sort?: "date_desc" | "date_asc" | "amount_desc" | "amount_asc";
	highlight?: string;
};

/** The part of the URL state the Filter sheet edits. */
export type FilterDraft = Pick<
	TransactionSearch,
	| "accountId"
	| "categoryId"
	| "uncategorised"
	| "from"
	| "to"
	| "direction"
	| "transfers"
	| "sort"
>;

export type FilterChip = {
	key: string;
	label: string;
	/** Merged into the search to take this one filter away. */
	clear: Partial<TransactionSearch>;
};

const SORT_LABELS: Record<NonNullable<TransactionSearch["sort"]>, string> = {
	date_desc: "Neueste zuerst",
	date_asc: "Älteste zuerst",
	amount_desc: "Größte Einnahme",
	amount_asc: "Größte Ausgabe",
};

function shortDate(iso: string): string {
	const [year, month, day] = iso.split("-");
	return `${day}.${month}.${year}`;
}

/**
 * One removable chip per active filter, so what narrows the list stays
 * visible after the Filter sheet is closed. Search text is not a chip: it sits
 * in the search field above them. A name that cannot be looked up falls back
 * to the kind of filter, never to an id.
 */
export function filterChips(
	search: TransactionSearch,
	names: {
		accounts: { id: string; name: string }[];
		categories: { id: string; name: string }[];
		merchant?: string | null;
		recurring?: string | null;
	},
): FilterChip[] {
	const chips: FilterChip[] = [];
	if (search.accountId)
		chips.push({
			key: "account",
			label:
				names.accounts.find((account) => account.id === search.accountId)
					?.name ?? "Konto",
			clear: { accountId: undefined },
		});
	if (search.uncategorised)
		chips.push({
			key: "uncategorised",
			label: "Ohne Kategorie",
			clear: { uncategorised: undefined },
		});
	else if (search.categoryId)
		chips.push({
			key: "category",
			label:
				names.categories.find((category) => category.id === search.categoryId)
					?.name ?? "Kategorie",
			clear: { categoryId: undefined },
		});
	if (search.merchantId)
		chips.push({
			key: "merchant",
			label: names.merchant ? `Händler: ${names.merchant}` : "Ein Händler",
			clear: { merchantId: undefined },
		});
	if (search.recurringPaymentId)
		chips.push({
			key: "recurring",
			label: names.recurring
				? `Zahlung: ${names.recurring}`
				: "Eine wiederkehrende Zahlung",
			clear: { recurringPaymentId: undefined },
		});
	if (search.from && search.to)
		chips.push({
			key: "period",
			label: `${shortDate(search.from)} – ${shortDate(search.to)}`,
			clear: { from: undefined, to: undefined },
		});
	else if (search.from)
		chips.push({
			key: "period",
			label: `ab ${shortDate(search.from)}`,
			clear: { from: undefined },
		});
	else if (search.to)
		chips.push({
			key: "period",
			label: `bis ${shortDate(search.to)}`,
			clear: { to: undefined },
		});
	if (search.direction)
		chips.push({
			key: "direction",
			label: search.direction === "outflow" ? "Ausgaben" : "Einnahmen",
			clear: { direction: undefined },
		});
	if (search.transfers === "hide")
		chips.push({
			key: "transfers",
			label: "Ohne Umbuchungen",
			clear: { transfers: undefined },
		});
	if (search.sort && search.sort !== "date_desc")
		chips.push({
			key: "sort",
			label: SORT_LABELS[search.sort],
			clear: { sort: undefined },
		});
	return chips;
}

/** The Filter sheet's starting values, taken from the URL. */
export function draftFromSearch(search: TransactionSearch): FilterDraft {
	return {
		accountId: search.accountId,
		categoryId: search.categoryId,
		uncategorised: search.uncategorised,
		from: search.from,
		to: search.to,
		direction: search.direction,
		transfers: search.transfers,
		sort: search.sort,
	};
}

/**
 * The draft as a search patch. Every key is present so a field the owner
 * emptied removes the filter instead of keeping the old one, and both
 * pagers go back to the first page because the list underneath changed.
 */
export function searchFromDraft(
	draft: FilterDraft,
): Partial<TransactionSearch> {
	return {
		accountId: draft.accountId || undefined,
		categoryId: draft.uncategorised ? undefined : draft.categoryId || undefined,
		uncategorised: draft.uncategorised || undefined,
		from: draft.from || undefined,
		to: draft.to || undefined,
		direction: draft.direction,
		transfers: draft.transfers,
		sort: draft.sort && draft.sort !== "date_desc" ? draft.sort : undefined,
		page: undefined,
		brokerPage: undefined,
	};
}

export type PeriodPreset = {
	key: string;
	label: string;
	from: string;
	to: string;
};

/** The periods people actually look up, relative to today. */
export function periodPresets(today: string): PeriodPreset[] {
	const lastMonth = addMonths(startOfMonth(today), -1);
	return [
		{
			key: "this-month",
			label: "Dieser Monat",
			from: startOfMonth(today),
			to: endOfMonth(today),
		},
		{
			key: "last-month",
			label: "Letzter Monat",
			from: lastMonth,
			to: endOfMonth(lastMonth),
		},
		{
			key: "90-days",
			label: "Letzte 90 Tage",
			from: addDays(today, -89),
			to: today,
		},
	];
}
