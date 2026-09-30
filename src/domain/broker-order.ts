/**
 * The pre-trade disclosure of a Scalable order, as the official CLI requires
 * it to be shown (rule `pre_trade_full_disclosure_v1`): every listed field,
 * human-readable, without omitting or changing a value, before the owner is
 * asked in a separate step whether to proceed. The paths below are the CLI's
 * own `required_leaf_paths` for `broker.trade.buy` and `broker.trade.sell`.
 */

export type OrderSide = "buy" | "sell";

type Leaf = { path: string; label: string; side?: OrderSide };

type Section = { key: string; title: string; leaves: Leaf[] };

const cost = (base: string, title: string): Leaf[] => [
	{
		path: `${base}/serviceCosts/amount`,
		label: `${title} · Dienstleistung, Betrag`,
	},
	{
		path: `${base}/serviceCosts/percentage`,
		label: `${title} · Dienstleistung, Prozent`,
	},
	{ path: `${base}/productCosts/amount`, label: `${title} · Produkt, Betrag` },
	{
		path: `${base}/productCosts/percentage`,
		label: `${title} · Produkt, Prozent`,
	},
	{ path: `${base}/total/amount`, label: `${title} · Summe, Betrag` },
	{ path: `${base}/total/percentage`, label: `${title} · Summe, Prozent` },
];

export const DISCLOSURE_SECTIONS: readonly Section[] = [
	{
		key: "trade_intent",
		title: "Auftrag",
		leaves: [
			{ path: "/result/intent/isin", label: "ISIN" },
			{ path: "/result/intent/shares", label: "Stück", side: "sell" },
			{ path: "/result/intent/order_type", label: "Ordertyp" },
			{
				path: "/result/intent/venue_override",
				label: "Handelsplatz (vorgegeben)",
			},
			{ path: "/result/intent/locale", label: "Sprache" },
		],
	},
	{
		key: "market_quote",
		title: "Kurs",
		leaves: [
			{ path: "/result/market_quote/mid_price", label: "Mittelkurs" },
			{ path: "/result/market_quote/ask_price", label: "Briefkurs" },
			{ path: "/result/market_quote/bid_price", label: "Geldkurs" },
			{ path: "/result/market_quote/currency", label: "Währung" },
			{ path: "/result/market_quote/is_outdated", label: "Kurs veraltet" },
			{ path: "/result/market_quote/timestamp_utc", label: "Kurszeit (UTC)" },
		],
	},
	{
		key: "calculation",
		title: "Berechnung",
		leaves: [
			{ path: "/result/calculation/shares", label: "Stück" },
			{
				path: "/result/calculation/estimated_order_volume_raw",
				label: "Geschätztes Ordervolumen (roh)",
			},
			{
				path: "/result/calculation/estimated_order_volume",
				label: "Geschätztes Ordervolumen",
			},
		],
	},
	{
		key: "tradability",
		title: "Handelbarkeit",
		leaves: [
			{ path: "/result/tradability/status", label: "Status" },
			{ path: "/result/tradability/selected_venue", label: "Handelsplatz" },
			{
				path: "/result/tradability/selected_venue_label",
				label: "Handelsplatz (Name)",
			},
			{
				path: "/result/tradability/selected_venue_status",
				label: "Status des Handelsplatzes",
			},
			{
				path: "/result/tradability/selected_venue_unavailability_reason",
				label: "Grund, falls nicht verfügbar",
			},
			{
				path: "/result/tradability/requires_appropriateness",
				label: "Angemessenheitsprüfung nötig",
			},
			{ path: "/result/tradability/tradable", label: "Handelbar" },
		],
	},
	{
		key: "warning",
		title: "Warnhinweis",
		leaves: [
			{ path: "/result/warning/kind", label: "Art" },
			{ path: "/result/warning/title", label: "Titel" },
			{ path: "/result/warning/version", label: "Version" },
			{ path: "/result/warning/locale", label: "Sprache" },
			{ path: "/result/warning/body", label: "Text" },
			{
				path: "/result/warning/acknowledgement_text",
				label: "Bestätigungstext",
			},
		],
	},
	{
		key: "price_warnings",
		title: "Kurswarnungen",
		leaves: [{ path: "/result/price_warnings/items", label: "Hinweise" }],
	},
	{
		key: "ex_ante_costs",
		title: "Kosten vorab (Ex-ante)",
		leaves: [
			{ path: "/result/ex_ante_costs/id", label: "Kennung" },
			...cost("/result/ex_ante_costs/entryCosts", "Einstieg"),
			...cost("/result/ex_ante_costs/ongoingCosts", "Laufend"),
			...cost("/result/ex_ante_costs/exitCosts", "Ausstieg"),
			{
				path: "/result/ex_ante_costs/effectOnReturn/initialYearCosts/amount",
				label: "Renditewirkung erstes Jahr, Betrag",
			},
			{
				path: "/result/ex_ante_costs/effectOnReturn/initialYearCosts/percentage",
				label: "Renditewirkung erstes Jahr, Prozent",
			},
			{
				path: "/result/ex_ante_costs/effectOnReturn/followingYearsCosts/amount",
				label: "Renditewirkung Folgejahre, Betrag",
			},
			{
				path: "/result/ex_ante_costs/effectOnReturn/followingYearsCosts/percentage",
				label: "Renditewirkung Folgejahre, Prozent",
			},
			{
				path: "/result/ex_ante_costs/effectOnReturn/finalYearCosts/amount",
				label: "Renditewirkung letztes Jahr, Betrag",
			},
			{
				path: "/result/ex_ante_costs/effectOnReturn/finalYearCosts/percentage",
				label: "Renditewirkung letztes Jahr, Prozent",
			},
			{
				path: "/result/ex_ante_costs/incidentalCosts/amount",
				label: "Nebenkosten, Betrag",
			},
			{
				path: "/result/ex_ante_costs/incidentalCosts/percentage",
				label: "Nebenkosten, Prozent",
			},
			{
				path: "/result/ex_ante_costs/fiveYearsCosts/amount",
				label: "Kosten über fünf Jahre, Betrag",
			},
			{
				path: "/result/ex_ante_costs/fiveYearsCosts/percentage",
				label: "Kosten über fünf Jahre, Prozent",
			},
		],
	},
	{
		key: "suitability",
		title: "Geeignetheit",
		leaves: [
			{ path: "/result/suitability/source", label: "Quelle" },
			{ path: "/result/suitability/type", label: "Art" },
			{ path: "/result/suitability/status", label: "Status" },
			{
				path: "/result/suitability/action_when_unsuitable",
				label: "Vorgehen, wenn ungeeignet",
			},
			{
				path: "/result/suitability/questionnaire_required",
				label: "Fragebogen nötig",
			},
			{
				path: "/result/suitability/questionnaire_reason",
				label: "Grund für den Fragebogen",
			},
			{
				path: "/result/suitability/requires_appropriateness_warning_acknowledgement",
				label: "Warnhinweis muss bestätigt werden",
			},
		],
	},
	{
		key: "regulatory_disclosures",
		title: "Pflichtangaben",
		leaves: [
			{
				path: "/result/regulatory_disclosures/market_data_notice",
				label: "Marktdaten",
				side: "buy",
			},
			{
				path: "/result/regulatory_disclosures/execution_instruction",
				label: "Ausführung",
			},
			{
				path: "/result/regulatory_disclosures/ex_ante_costs_notice",
				label: "Kostenhinweis",
				side: "buy",
			},
		],
	},
	{
		key: "document_links",
		title: "Dokumente",
		leaves: [
			{
				path: "/result/document_links/client_documents",
				label: "Kundendokumente",
			},
			{
				path: "/result/document_links/primary_kid",
				label: "Basisinformationsblatt",
			},
			{
				path: "/result/document_links/secondary_kid",
				label: "Weiteres Basisinformationsblatt",
			},
		],
	},
	{
		key: "confirmation",
		title: "Bestätigung",
		leaves: [
			{ path: "/confirmation/id", label: "Bestätigungskennung" },
			{
				path: "/confirmation/expires_at_epoch",
				label: "Gültig bis (Unix-Zeit)",
			},
		],
	},
];

/** Every leaf the CLI requires for this side, in its section order. */
export function requiredLeafPaths(side: OrderSide): string[] {
	return DISCLOSURE_SECTIONS.flatMap((section) =>
		section.leaves
			.filter((leaf) => !leaf.side || leaf.side === side)
			.map((leaf) => leaf.path),
	);
}

/** A JSON pointer into the preview; `undefined` when the path is absent. */
export function pointer(value: unknown, path: string): unknown {
	let current = value;
	for (const part of path.split("/").slice(1)) {
		if (current === null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

/**
 * One value as text, unchanged: numbers and strings exactly as sent, `null`
 * as the literal `null`, lists and objects spelled out entry by entry. A
 * missing field says so rather than disappearing.
 */
export function disclosureText(value: unknown): string[] {
	if (value === undefined) return ["(nicht geliefert)"];
	if (value === null) return ["null"];
	if (typeof value === "string") return [value];
	if (typeof value === "number" || typeof value === "boolean")
		return [String(value)];
	if (Array.isArray(value))
		return value.length === 0
			? ["(keine)"]
			: value.flatMap((entry) => disclosureText(entry));
	return Object.entries(value as Record<string, unknown>).flatMap(
		([key, entry]) => disclosureText(entry).map((line) => `${key}: ${line}`),
	);
}

export type DisclosureRow = { path: string; label: string; lines: string[] };

export function disclosure(
	preview: unknown,
	side: OrderSide,
): { key: string; title: string; rows: DisclosureRow[] }[] {
	return DISCLOSURE_SECTIONS.map((section) => ({
		key: section.key,
		title: section.title,
		rows: section.leaves
			.filter((leaf) => !leaf.side || leaf.side === side)
			.map((leaf) => ({
				path: leaf.path,
				label: leaf.label,
				lines: disclosureText(pointer(preview, leaf.path)),
			})),
	}));
}

/** The confirmation phase 1 handed out, or null when it is missing. */
export function previewConfirmation(
	preview: unknown,
): { id: string; expiresAt: Date } | null {
	const id = pointer(preview, "/confirmation/id");
	const epoch = pointer(preview, "/confirmation/expires_at_epoch");
	if (typeof id !== "string" || !/^[A-Za-z0-9_-]{4,128}$/.test(id)) return null;
	const seconds = typeof epoch === "number" ? epoch : Number(epoch);
	if (!Number.isFinite(seconds)) return null;
	return { id, expiresAt: new Date(seconds * 1000) };
}

/** Whether phase 2 needs the owner to acknowledge a warning first. */
export function requiresAcknowledgement(preview: unknown): boolean {
	return (
		pointer(preview, "/result/tradability/requires_appropriateness") === true ||
		pointer(
			preview,
			"/result/suitability/requires_appropriateness_warning_acknowledgement",
		) === true
	);
}

/** Whether the preview says the order can be placed at all. */
export function previewTradable(preview: unknown): boolean {
	return pointer(preview, "/result/tradability/tradable") !== false;
}

export type HeldInstrument = { isin: string; quantity: number };

/**
 * The owner allowed orders only for instruments already in the depot, with
 * no amount limit. A sell may not exceed the shares held.
 */
export function validateOrderRequest(
	request:
		| { side: "buy"; isin: string; amountMinor: number }
		| { side: "sell"; isin: string; shares: number },
	held: readonly HeldInstrument[],
): string | null {
	const holding = held.find((entry) => entry.isin === request.isin);
	if (!holding) return "Nur Wertpapiere, die bereits im Depot liegen.";
	if (request.side === "buy")
		return Number.isSafeInteger(request.amountMinor) &&
			request.amountMinor >= 100
			? null
			: "Der Kaufbetrag muss mindestens 1,00 € sein.";
	if (!(request.shares > 0)) return "Die Stückzahl muss größer als null sein.";
	return request.shares <= holding.quantity + 1e-9
		? null
		: "Es liegen weniger Stücke im Depot, als verkauft werden sollen.";
}
