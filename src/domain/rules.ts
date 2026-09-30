// Deterministic categorisation. Rules are evaluated in priority order (lower
// number first); the first rule whose every set condition holds wins. This is
// intentionally simple so an AI classifier can later run *after* the rules and
// only fill in what stayed uncategorised.

export type RuleDirection = "inflow" | "outflow";

export type Rule = {
	id: string;
	priority: number;
	isActive: boolean;
	descriptionContains: string | null;
	merchantContains: string | null;
	counterpartyIban: string | null;
	amountMinMinor: number | null;
	amountMaxMinor: number | null;
	accountId: string | null;
	direction: RuleDirection | null;
	categoryId: string;
	setMerchantName: string | null;
};

export type RuleSubject = {
	accountId: string;
	description: string;
	merchantName?: string | null;
	counterpartyName?: string | null;
	counterpartyIban?: string | null;
	amountMinor: number;
};

export type RuleMatch = {
	ruleId: string;
	categoryId: string;
	merchantName: string | null;
};

function includesCi(
	haystack: string | null | undefined,
	needle: string,
): boolean {
	if (!haystack) return false;
	return haystack.toLowerCase().includes(needle.trim().toLowerCase());
}

export function ruleMatches(rule: Rule, subject: RuleSubject): boolean {
	if (!rule.isActive) return false;
	if (rule.accountId && rule.accountId !== subject.accountId) return false;
	if (rule.direction) {
		const dir: RuleDirection = subject.amountMinor < 0 ? "outflow" : "inflow";
		if (dir !== rule.direction) return false;
	}
	const abs = Math.abs(subject.amountMinor);
	if (rule.amountMinMinor !== null && abs < rule.amountMinMinor) return false;
	if (rule.amountMaxMinor !== null && abs > rule.amountMaxMinor) return false;
	if (rule.descriptionContains) {
		const inDesc = includesCi(subject.description, rule.descriptionContains);
		const inCounterparty = includesCi(
			subject.counterpartyName,
			rule.descriptionContains,
		);
		if (!inDesc && !inCounterparty) return false;
	}
	if (rule.merchantContains) {
		const inMerchant = includesCi(subject.merchantName, rule.merchantContains);
		const inCounterparty = includesCi(
			subject.counterpartyName,
			rule.merchantContains,
		);
		const inDesc = includesCi(subject.description, rule.merchantContains);
		if (!inMerchant && !inCounterparty && !inDesc) return false;
	}
	if (rule.counterpartyIban) {
		const want = rule.counterpartyIban.replace(/\s/g, "").toUpperCase();
		const have = (subject.counterpartyIban ?? "")
			.replace(/\s/g, "")
			.toUpperCase();
		if (want !== have) return false;
	}
	// A rule with no conditions at all never matches: it would swallow everything.
	const hasCondition =
		rule.descriptionContains ||
		rule.merchantContains ||
		rule.counterpartyIban ||
		rule.amountMinMinor !== null ||
		rule.amountMaxMinor !== null ||
		rule.accountId ||
		rule.direction;
	return Boolean(hasCondition);
}

export function sortRules(rules: readonly Rule[]): Rule[] {
	return [...rules].sort(
		(a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
	);
}

export function applyRules(
	rules: readonly Rule[],
	subject: RuleSubject,
): RuleMatch | null {
	for (const rule of sortRules(rules)) {
		if (ruleMatches(rule, subject)) {
			return {
				ruleId: rule.id,
				categoryId: rule.categoryId,
				merchantName: rule.setMerchantName,
			};
		}
	}
	return null;
}
