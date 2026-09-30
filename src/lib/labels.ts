export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
	current: "Girokonto",
	savings: "Sparkonto",
	credit_card: "Kreditkarte",
	cash: "Bargeld",
	investment: "Depotkonto",
	wallet: "Bezahldienst",
};
export const ASSET_CATEGORY_LABELS: Record<string, string> = {
	real_estate: "Immobilie",
	vehicle: "Fahrzeug",
	watch: "Uhr",
	collectible: "Sammlerstück",
	precious_metal: "Edelmetall",
	inventory: "Verkaufsbestand",
	private_investment: "Private Beteiligung",
	other: "Sonstiges",
};
export const LIABILITY_TYPE_LABELS: Record<string, string> = {
	credit_card: "Kreditkarte",
	personal_loan: "Privatkredit",
	mortgage: "Immobiliendarlehen",
	vehicle_finance: "Fahrzeugfinanzierung",
	other: "Sonstige Verbindlichkeit",
};
export const FREQUENCY_LABELS: Record<string, string> = {
	weekly: "Wöchentlich",
	biweekly: "Alle 2 Wochen",
	monthly: "Monatlich",
	bimonthly: "Alle 2 Monate",
	quarterly: "Vierteljährlich",
	semiannual: "Halbjährlich",
	yearly: "Jährlich",
	custom: "Benutzerdefiniert",
};
export const INVESTMENT_TRANSACTION_KIND_LABELS: Record<string, string> = {
	buy: "Kauf",
	sell: "Verkauf",
	dividend: "Ausschüttung",
	fee: "Gebühr",
	tax: "Steuer",
	deposit: "Einzahlung",
	withdrawal: "Auszahlung",
	interest: "Zinsen",
	other: "Sonstiges",
};
export const INVESTMENT_TRANSACTION_STATUS_LABELS: Record<string, string> = {
	BOOKED: "Gebucht",
	FILLED: "Ausgeführt",
	SETTLED: "Abgeschlossen",
	PENDING: "Ausstehend",
	CANCELLED: "Storniert",
	REJECTED: "Abgelehnt",
	UNKNOWN: "Unbekannt",
};

/**
 * Brokers invent their own codes; show a readable word, never a raw token.
 * An unknown code is an identifier, not a name anyone chose, so it falls back
 * to "—" like every other label map. Lower-casing it turned a broker's
 * "PARTIALLY_FILLED" into English prose in a German table.
 */
export function investmentStatusLabel(status: string): string {
	return INVESTMENT_TRANSACTION_STATUS_LABELS[status.toUpperCase()] ?? "—";
}

const ASSET_CLASS_LABELS: Record<string, string> = {
	STOCK: "Aktie",
	SHARE: "Aktie",
	EQUITY: "Aktie",
	ETF: "ETF",
	FUND: "Fonds",
	BOND: "Anleihe",
	CRYPTO: "Krypto",
	DERIVATIVE: "Derivat",
	CERTIFICATE: "Zertifikat",
	COMMODITY: "Rohstoff",
	CASH: "Bargeld",
};

/** A broker's asset class code; an unknown code falls back to "—". */
export function assetClassLabel(value: string): string {
	return ASSET_CLASS_LABELS[value.toUpperCase()] ?? "—";
}
export const SYNC_STATUS_LABELS: Record<string, string> = {
	manual: "Manuell",
	synced: "Synchronisiert",
	pending: "Ausstehend",
	error: "Fehler",
	disconnected: "Getrennt",
};
export const CATEGORY_KIND_LABELS: Record<string, string> = {
	income: "Einnahme",
	expense: "Ausgabe",
	transfer: "Umbuchung",
	other: "Sonstiges",
};
export const VALUATION_SOURCE_LABELS: Record<string, string> = {
	manual: "Manuell",
	appraisal: "Gutachten",
	market: "Marktwert",
	purchase: "Kaufpreis",
};
export const CATEGORY_SOURCE_LABELS: Record<string, string> = {
	manual: "Manuell",
	rule: "Regel",
	import: "Import",
	recurring: "Wiederkehrend",
	ai: "KI",
	auto: "Automatisch",
};
export const IMPORT_SOURCE_LABELS: Record<string, string> = {
	manual: "Manuell",
	csv: "CSV",
	seed: "Demodaten",
	cash: "Bargeld",
	paypal: "PayPal",
};
/** Where a booking came from. An unknown source reads "—", never the raw id. */
export function importSourceLabel(source: string): string {
	// "provider:enable-banking" used to print as "Anbieter: enable-banking".
	if (source === "provider:enable-banking") return "Bankabruf";
	if (source.startsWith("provider:")) return "—";
	return IMPORT_SOURCE_LABELS[source] ?? "—";
}
