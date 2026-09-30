/**
 * The owner's own investment rules and the "Warum jetzt?" before a sale —
 * the owner's decision of 28.09.2026 as a counterweight to a net worth that
 * ticks every second and orders that take a few taps.
 *
 * The rules are written once, in a calm moment, and shown back at the one
 * moment they are for: before a sale is previewed. A sale then needs one
 * sentence of the owner's own reasoning, stored with the order. Neither is
 * advice or broker data; both are the owner's words, kept as written.
 */

/** Room for a handful of sentences, not an essay nobody rereads. */
export const INVESTMENT_RULES_MAX = 2_000;
/** About one short sentence: "weil" plus a reason, not a shrug. */
export const SELL_REASON_MIN = 10;
export const SELL_REASON_MAX = 500;

/** Examples for the empty field only; never stored, never prefilled. */
export const INVESTMENT_RULES_PLACEHOLDER = [
	"Ich verkaufe nur, wenn ich das Geld in den nächsten zwei Jahren brauche oder meine Aufteilung um mehr als fünf Prozentpunkte vom Ziel abweicht.",
	"Im Crash tue ich nichts außer weiter zu sparen.",
	"Ich verkaufe nie wegen einer Nachricht oder eines schlechten Tages.",
].join("\n");

/**
 * The rules as stored: line endings unified, trailing space per line and
 * blank lines around the text removed. Empty means "no rules" (null).
 */
export function normaliseInvestmentRules(
	text: string | null | undefined,
): string | null {
	if (!text) return null;
	const cleaned = text
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.replace(/\s+$/, ""))
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return cleaned ? cleaned : null;
}

/** German sentence when the rules cannot be stored, else null. */
export function investmentRulesProblem(
	text: string | null | undefined,
): string | null {
	const cleaned = normaliseInvestmentRules(text);
	if (cleaned && cleaned.length > INVESTMENT_RULES_MAX)
		return `Die Anlageregeln dürfen höchstens ${INVESTMENT_RULES_MAX.toLocaleString("de-DE")} Zeichen lang sein.`;
	return null;
}

/** One line, whitespace collapsed: a sentence, not a layout. */
export function normaliseSellReason(reason: string | null | undefined): string {
	return (reason ?? "").replace(/\s+/g, " ").trim();
}

/** German sentence when the reason does not count as one, else null. */
export function sellReasonProblem(
	reason: string | null | undefined,
): string | null {
	const cleaned = normaliseSellReason(reason);
	if (cleaned.length < SELL_REASON_MIN)
		return "Bitte in einem Satz notieren, warum Sie jetzt verkaufen.";
	if (cleaned.length > SELL_REASON_MAX)
		return `Der Grund darf höchstens ${SELL_REASON_MAX} Zeichen lang sein.`;
	return null;
}
