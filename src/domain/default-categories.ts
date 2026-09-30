export type DefaultCategory = {
	name: string;
	slug: string;
	kind: "income" | "expense" | "transfer" | "other";
	icon: string;
	children?: { name: string; slug: string; icon?: string }[];
};

// Sensible defaults created for every new user. Everything here can be
// renamed, re-parented or deleted; `isSystem` only marks the origin.
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
	{
		name: "Einnahmen",
		slug: "income",
		kind: "income",
		icon: "banknote",
		children: [
			{ name: "Gehalt", slug: "salary", icon: "briefcase" },
			{
				name: "Dividenden & Zinsen",
				slug: "dividends-interest",
				icon: "percent",
			},
			{ name: "Erstattungen", slug: "refunds", icon: "undo-2" },
			{ name: "Sonstige Einnahmen", slug: "other-income" },
		],
	},
	{
		name: "Wohnen",
		slug: "housing",
		kind: "expense",
		icon: "house",
		children: [
			{ name: "Miete & Darlehen", slug: "rent-mortgage" },
			{ name: "Nebenkosten", slug: "utilities", icon: "zap" },
			{ name: "Internet & Telefon", slug: "internet-phone", icon: "wifi" },
			{ name: "Haushalt", slug: "household" },
		],
	},
	{
		name: "Lebensmittel",
		slug: "groceries",
		kind: "expense",
		icon: "shopping-basket",
	},
	{
		name: "Restaurants",
		slug: "restaurants",
		kind: "expense",
		icon: "utensils",
		children: [
			{ name: "Kaffee & Snacks", slug: "coffee-snacks", icon: "coffee" },
		],
	},
	{
		name: "Mobilität",
		slug: "mobility",
		kind: "expense",
		icon: "train-front",
		children: [
			{ name: "Öffentlicher Verkehr", slug: "public-transport" },
			{ name: "Auto", slug: "car", icon: "car" },
			{ name: "Parken & Maut", slug: "parking-tolls" },
		],
	},
	{ name: "Kraftstoff", slug: "fuel", kind: "expense", icon: "fuel" },
	{
		name: "Versicherungen",
		slug: "insurance",
		kind: "expense",
		icon: "shield",
	},
	{
		name: "Einkäufe",
		slug: "shopping",
		kind: "expense",
		icon: "shopping-bag",
		children: [
			{ name: "Kleidung", slug: "clothing", icon: "shirt" },
			{ name: "Elektronik", slug: "electronics", icon: "smartphone" },
		],
	},
	{
		name: "Gesundheit",
		slug: "health",
		kind: "expense",
		icon: "heart-pulse",
		children: [
			{ name: "Apotheke", slug: "pharmacy", icon: "pill" },
			{ name: "Fitness", slug: "fitness", icon: "dumbbell" },
		],
	},
	{ name: "Reisen", slug: "travel", kind: "expense", icon: "plane" },
	{
		name: "Technologie",
		slug: "technology",
		kind: "expense",
		icon: "server",
		children: [
			{ name: "Hosting & Domains", slug: "hosting-domains", icon: "globe" },
			{ name: "Software", slug: "software", icon: "code" },
		],
	},
	{
		name: "Abonnements",
		slug: "subscriptions",
		kind: "expense",
		icon: "repeat",
		children: [
			{ name: "Streaming", slug: "streaming", icon: "tv" },
			{ name: "Nachrichten & Medien", slug: "news-media", icon: "newspaper" },
		],
	},
	{ name: "Freizeit", slug: "leisure", kind: "expense", icon: "ticket" },
	{
		name: "Bildung",
		slug: "education",
		kind: "expense",
		icon: "graduation-cap",
	},
	{
		name: "Geschenke & Spenden",
		slug: "gifts-donations",
		kind: "expense",
		icon: "gift",
	},
	{
		name: "Steuern & Gebühren",
		slug: "taxes-fees",
		kind: "expense",
		icon: "landmark",
		children: [{ name: "Bankgebühren", slug: "bank-fees" }],
	},
	{
		name: "Umbuchungen",
		slug: "transfers",
		kind: "transfer",
		icon: "arrow-left-right",
		children: [
			{ name: "Sparen", slug: "savings-transfer" },
			{
				name: "Kreditkartenzahlung",
				slug: "credit-card-payment",
				icon: "credit-card",
			},
		],
	},
	{
		name: "Wertpapiere",
		slug: "investments",
		kind: "transfer",
		icon: "trending-up",
	},
	{
		name: "Kredittilgung",
		slug: "loan-repayment",
		kind: "expense",
		icon: "receipt",
	},
	{ name: "Sonstiges", slug: "other", kind: "other", icon: "circle-dashed" },
];
