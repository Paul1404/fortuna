import { merchantKey, namesCounterparty } from "./normalize";
import { applyRules, type Rule, type RuleSubject } from "./rules";

/**
 * Proposes a category for every booking that has none, so the owner confirms a
 * batch instead of picking one dropdown at a time.
 *
 * The split that matters is not how confident anything feels — it is whether
 * the proposal rests on a decision the owner already made. A rule they wrote, a
 * merchant they gave a default to, a recurring payment they set up, or a run of
 * bookings from the same merchant they categorised the same way every time: all
 * of those are the owner's own answer being applied again. Anything else is a
 * guess and belongs in the pile they pick through themselves.
 */

export type SuggestionSource =
	/** A categorisation rule the owner wrote. */
	| "rule"
	/** The default category on the merchant record. */
	| "merchant_default"
	/** The category of the recurring payment this booking belongs to. */
	| "recurring"
	/** Every earlier booking from this merchant carries the same category. */
	| "history";

export type CategorySuggestion = {
	transactionId: string;
	categoryId: string;
	source: SuggestionSource;
	/** German sentence naming the evidence, shown beside the row. */
	evidence: string;
	/**
	 * True when the proposal only repeats a decision the owner already made.
	 * These are pre-ticked; the rest start unticked and must be chosen.
	 */
	certain: boolean;
};

export type UncategorisedTransaction = {
	id: string;
	accountId: string;
	description: string;
	merchantName: string | null;
	counterpartyName: string | null;
	counterpartyIban: string | null;
	amountMinor: number;
	recurringPaymentId: string | null;
};

export type CategorisedPrior = {
	merchantName: string | null;
	description: string;
	counterpartyName: string | null;
	amountMinor: number;
	categoryId: string;
	/** "manual" carries more weight: the owner typed it in themselves. */
	categorySource: string | null;
};

/**
 * Merchant plus direction. A refund from a shop is not the same thing as a
 * purchase there, and lumping them together would propose "Lebensmittel" for
 * money coming back in.
 */
export function suggestionKey(
	merchantName: string | null,
	counterpartyName: string | null,
	description: string,
	amountMinor: number,
): string | null {
	// A placeholder text names nobody. Keyed on it, a broker deposit and a
	// refund without counterparty became "earlier bookings from Ohne
	// Verwendungszweck" and proposed each other's category.
	if (!namesCounterparty(merchantName, counterpartyName, description))
		return null;
	const key = merchantKey(merchantName ?? counterpartyName, description);
	if (!key) return null;
	return `${amountMinor < 0 ? "out" : "in"}|${key}`;
}

export type HistoryConsensus = {
	categoryId: string;
	/** How many earlier bookings from this merchant and direction were seen. */
	count: number;
	/** Share of them carrying `categoryId`, 0..1. */
	share: number;
	/** How many of those the owner categorised by hand. */
	manualCount: number;
};

/**
 * What the owner has consistently done with this merchant before.
 *
 * One earlier booking is an anecdote, so two is the floor, and a merchant the
 * owner has categorised two different ways is exactly the case they have to
 * decide themselves.
 */
export function historyConsensus(
	priors: readonly CategorisedPrior[],
): HistoryConsensus | null {
	if (priors.length === 0) return null;
	const counts = new Map<string, { total: number; manual: number }>();
	for (const prior of priors) {
		const entry = counts.get(prior.categoryId) ?? { total: 0, manual: 0 };
		entry.total += 1;
		if (prior.categorySource === "manual") entry.manual += 1;
		counts.set(prior.categoryId, entry);
	}
	let best: [string, { total: number; manual: number }] | null = null;
	for (const entry of counts)
		if (!best || entry[1].total > best[1].total) best = entry;
	if (!best) return null;
	return {
		categoryId: best[0],
		count: priors.length,
		share: best[1].total / priors.length,
		manualCount: best[1].manual,
	};
}

/**
 * Consistent enough to pre-tick: either the owner has categorised this merchant
 * by hand and never contradicted it, or a longer unbroken run of the same
 * category however it was set.
 */
function historyIsCertain(consensus: HistoryConsensus): boolean {
	if (consensus.share < 1) return false;
	return consensus.manualCount >= 1
		? consensus.count >= 2
		: consensus.count >= 4;
}

/** Worth proposing at all, even though the owner has to confirm it. */
function historyIsWorthProposing(consensus: HistoryConsensus): boolean {
	return consensus.count >= 2 && consensus.share >= 0.6;
}

export function proposeCategories(input: {
	transactions: readonly UncategorisedTransaction[];
	rules: readonly Rule[];
	/** Default category per merchant record, keyed by lower-cased name. */
	merchantDefaults: ReadonlyMap<string, string>;
	/** Category of each recurring payment, keyed by its id. */
	recurringCategories: ReadonlyMap<string, string>;
	/** Earlier categorised bookings grouped by `suggestionKey`. */
	priorsByKey: ReadonlyMap<string, readonly CategorisedPrior[]>;
	/** Category names for the evidence sentences, keyed by id. */
	categoryNames: ReadonlyMap<string, string>;
	/** Rule names for the evidence sentences, keyed by rule id. */
	ruleNames: ReadonlyMap<string, string>;
}): { suggestions: CategorySuggestion[]; notes: Map<string, string> } {
	const suggestions: CategorySuggestion[] = [];
	// Why a booking got no proposal, where there is something worth saying. A
	// merchant the owner has filed two different ways is not a merchant Fortuna
	// has never seen, and telling them the latter would be a lie.
	const notes = new Map<string, string>();
	for (const transaction of input.transactions) {
		const subject: RuleSubject = {
			accountId: transaction.accountId,
			description: transaction.description,
			counterpartyName: transaction.counterpartyName,
			counterpartyIban: transaction.counterpartyIban,
			amountMinor: transaction.amountMinor,
		};
		const add = (
			categoryId: string,
			source: SuggestionSource,
			evidence: string,
			certain: boolean,
		) => {
			suggestions.push({
				transactionId: transaction.id,
				categoryId,
				source,
				evidence,
				certain,
			});
		};

		// The owner's own rule wins, exactly as it does on import.
		const match = applyRules(input.rules, subject);
		if (match?.categoryId) {
			add(
				match.categoryId,
				"rule",
				`Deine Regel „${input.ruleNames.get(match.ruleId) ?? "ohne Namen"}" trifft zu.`,
				true,
			);
			continue;
		}

		if (transaction.recurringPaymentId) {
			const categoryId = input.recurringCategories.get(
				transaction.recurringPaymentId,
			);
			if (categoryId) {
				add(
					categoryId,
					"recurring",
					"Gehört zu einer wiederkehrenden Zahlung mit dieser Kategorie.",
					true,
				);
				continue;
			}
		}

		const merchantDefault = transaction.merchantName
			? input.merchantDefaults.get(transaction.merchantName.toLowerCase())
			: undefined;
		if (merchantDefault) {
			add(
				merchantDefault,
				"merchant_default",
				`Für ${transaction.merchantName} hast du diese Kategorie hinterlegt.`,
				true,
			);
			continue;
		}

		const key = suggestionKey(
			transaction.merchantName,
			transaction.counterpartyName,
			transaction.description,
			transaction.amountMinor,
		);
		const consensus = key
			? historyConsensus(input.priorsByKey.get(key) ?? [])
			: null;
		if (consensus && !historyIsWorthProposing(consensus)) {
			const name = transaction.merchantName ?? transaction.counterpartyName;
			notes.set(
				transaction.id,
				`Du hast ${name ?? "diesen Händler"} bisher unterschiedlich zugeordnet — hier gibt es kein Muster.`,
			);
		}
		if (consensus && historyIsWorthProposing(consensus)) {
			const name = transaction.merchantName ?? transaction.counterpartyName;
			const label = input.categoryNames.get(consensus.categoryId) ?? "";
			add(
				consensus.categoryId,
				"history",
				consensus.share === 1
					? `Alle ${consensus.count} früheren Buchungen${name ? ` von ${name}` : ""} sind „${label}".`
					: `${Math.round(consensus.share * 100)} % der ${consensus.count} früheren Buchungen${name ? ` von ${name}` : ""} sind „${label}" — die übrigen nicht.`,
				historyIsCertain(consensus),
			);
		}
	}
	return { suggestions, notes };
}

export type ConsultAssignment = {
	merchant: string;
	/** Null when the category does not exist yet and has to be created. */
	categoryId: string | null;
	categoryName: string;
	isNew: boolean;
	reason: string;
};

/** One booking's answer from a consultation, as the review receives it. */
export type ConsultedBooking = {
	transactionId: string;
	categoryId: string | null;
	categoryName: string;
	reason: string;
};

/**
 * Sorts Hr. Körner's answer for the review form: bookings filed under an
 * existing category, his reason per booking, and the new categories he
 * proposes with the bookings each would cover.
 *
 * Computed once, outside any state updater. It used to be gathered inside the
 * `setPicks` updater, which React runs later, during the next render — so the
 * proposals were read while still empty and "Neue Kategorien vorgeschlagen"
 * never appeared.
 */
export function readConsultation(assignments: ConsultedBooking[]): {
	filled: Record<string, string>;
	reasons: Record<string, string>;
	proposals: { name: string; forRows: string[]; reason: string }[];
} {
	const filled: Record<string, string> = {};
	const reasons: Record<string, string> = {};
	const proposals = new Map<
		string,
		{ name: string; forRows: string[]; reason: string }
	>();
	for (const row of assignments) {
		reasons[row.transactionId] = row.reason;
		if (row.categoryId) {
			filled[row.transactionId] = row.categoryId;
			continue;
		}
		const proposal = proposals.get(row.categoryName) ?? {
			name: row.categoryName,
			forRows: [],
			reason: row.reason,
		};
		proposal.forRows.push(row.transactionId);
		proposals.set(row.categoryName, proposal);
	}
	return { filled, reasons, proposals: [...proposals.values()] };
}

export type Consultation = {
	message: string;
	assignments: ConsultAssignment[];
	questions: { merchant: string; question: string; options: string[] }[];
};

/** Bounds on anything that came out of a model and is shown or stored. */
const MAX_NAME = 40;
const MAX_TEXT = 300;
const MAX_QUESTIONS = 3;
const MAX_OPTIONS = 4;

function clean(value: unknown, limit: number): string {
	if (typeof value !== "string") return "";
	// Control and formatting characters would break out of the line they are
	// rendered in, and a category name carrying them would be unusable.
	return value.replace(/\p{C}/gu, " ").trim().slice(0, limit);
}

/**
 * Turns Hr. Koerner's answer into proposals, discarding anything that does not
 * survive checking.
 *
 * The answer is untrusted input: it arrives as prose that may or may not hold
 * JSON, and it can name a merchant that was never asked about. A category name
 * that is not one the owner has is not rejected — proposing one is the point,
 * because a short category list is exactly when mapping onto it goes wrong —
 * but it is marked `isNew` and carries no id, so nothing can be written until
 * the owner creates it.
 */
export function parseConsultation(
	raw: string,
	asked: {
		merchants: readonly string[];
		categories: readonly { id: string; name: string }[];
	},
): Consultation {
	const empty: Consultation = { message: "", assignments: [], questions: [] };
	const categoryByName = new Map(
		asked.categories.map((row) => [row.name.toLowerCase(), row.id]),
	);
	const merchantByName = new Map(
		asked.merchants.map((name) => [name.toLowerCase(), name]),
	);
	const start = raw.indexOf("{");
	const end = raw.lastIndexOf("}");
	if (start === -1 || end <= start) return empty;
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
	} catch {
		return empty;
	}

	const seen = new Set<string>();
	const assignments: ConsultAssignment[] = [];
	if (Array.isArray(parsed.zuordnungen))
		for (const row of parsed.zuordnungen) {
			if (!row || typeof row !== "object") continue;
			const entry = row as Record<string, unknown>;
			const merchant = merchantByName.get(
				clean(entry.haendler, MAX_NAME).toLowerCase(),
			);
			const name = clean(entry.kategorie, MAX_NAME);
			if (!merchant || !name || seen.has(merchant.toLowerCase())) continue;
			const categoryId = categoryByName.get(name.toLowerCase()) ?? null;
			seen.add(merchant.toLowerCase());
			assignments.push({
				merchant,
				categoryId,
				categoryName: categoryId
					? (asked.categories.find((row) => row.id === categoryId)?.name ??
						name)
					: name,
				isNew: categoryId === null,
				reason: clean(entry.begruendung, MAX_TEXT),
			});
		}

	const questions: Consultation["questions"] = [];
	if (Array.isArray(parsed.rueckfragen))
		for (const row of parsed.rueckfragen) {
			if (!row || typeof row !== "object") continue;
			if (questions.length >= MAX_QUESTIONS) break;
			const entry = row as Record<string, unknown>;
			const merchant = merchantByName.get(
				clean(entry.haendler, MAX_NAME).toLowerCase(),
			);
			const question = clean(entry.frage, MAX_TEXT);
			// A merchant he both filed and asked about would appear twice, once as
			// an answer and once as an open question.
			if (!merchant || !question || seen.has(merchant.toLowerCase())) continue;
			seen.add(merchant.toLowerCase());
			questions.push({
				merchant,
				question,
				options: Array.isArray(entry.antworten)
					? entry.antworten
							.map((option) => clean(option, MAX_NAME))
							.filter(Boolean)
							.slice(0, MAX_OPTIONS)
					: [],
			});
		}

	return { message: clean(parsed.nachricht, MAX_TEXT), assignments, questions };
}
