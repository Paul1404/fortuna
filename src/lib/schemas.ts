import * as v from "valibot";
import { isIsoDate } from "@/domain/dates";
import {
	INVESTMENT_RULES_MAX,
	investmentRulesProblem,
	SELL_REASON_MAX,
	sellReasonProblem,
} from "@/domain/investment-rules";

// Validation schemas shared by oRPC procedures (server) and forms (client).

export const isoDate = v.pipe(
	v.string(),
	v.regex(/^\d{4}-\d{2}-\d{2}$/, "Format JJJJ-MM-TT verwenden"),
	v.check(isIsoDate, "Kein gültiges Kalenderdatum"),
);
export const optionalIsoDate = v.optional(v.nullable(isoDate));
export const currencyCode = v.pipe(
	v.string(),
	v.regex(/^[A-Z]{3}$/, "Dreistelliger ISO-Code"),
);
export const id = v.pipe(v.string(), v.minLength(1), v.maxLength(64));
export const optionalId = v.optional(v.nullable(id));
export const minor = v.pipe(
	v.number(),
	v.integer(),
	v.minValue(-9_000_000_000_000),
	v.maxValue(9_000_000_000_000),
);
export const nonNegativeMinor = v.pipe(
	v.number(),
	v.integer(),
	v.minValue(0),
	v.maxValue(9_000_000_000_000),
);
export const shortText = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1),
	v.maxLength(200),
);
export const optionalText = v.optional(
	v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(2000))),
);
export const notes = v.optional(
	v.nullable(v.pipe(v.string(), v.maxLength(5000))),
);

const splitBps = v.optional(
	v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10000)),
);

/**
 * Goal, reserve and target split: the one place "Anlegen", the desk and
 * Hr. Körner read them from. The service checks the split totals 100 %.
 */
export const InvestmentTargetsUpdate = v.object({
	goalName: v.optional(
		v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(80))),
	),
	targetNetWorthMinor: v.optional(v.nullable(nonNegativeMinor)),
	targetNetWorthDate: v.optional(v.nullable(isoDate)),
	monthlySavingsTargetMinor: v.optional(v.nullable(nonNegativeMinor)),
	minimumCashReserveMinor: v.optional(v.nullable(nonNegativeMinor)),
	reserveMonths: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(24)),
	),
	targetEquityBps: splitBps,
	targetBondBps: splitBps,
	targetCashBps: splitBps,
	targetOtherBps: splitBps,
});

export const FinancialProfileUpdate = v.object({
	...InvestmentTargetsUpdate.entries,
	largePurchaseThresholdMinor: v.optional(v.nullable(nonNegativeMinor)),
	unusualSpendMultiplierBps: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(11000), v.maxValue(100000)),
	),
	alertSensitivity: v.optional(v.picklist(["quiet", "balanced", "detailed"])),
	ignoredCategoryIds: v.optional(v.array(id)),
	weeklyReportEnabled: v.optional(v.boolean()),
	// Session-only: deliberately not in InvestmentTargetsUpdate, which the
	// Copilot writes through.
	investmentRules: v.optional(
		v.nullable(
			v.pipe(
				v.string(),
				v.maxLength(INVESTMENT_RULES_MAX * 2),
				v.check(
					(text) => investmentRulesProblem(text) === null,
					`Höchstens ${INVESTMENT_RULES_MAX} Zeichen`,
				),
			),
		),
	),
});

export const FinancialObservationUpdate = v.object({
	id,
	status: v.picklist(["dismissed", "intentional", "snoozed", "open"]),
	snoozedUntil: v.optional(v.nullable(v.date())),
});

export const ACCOUNT_TYPES = [
	"current",
	"savings",
	"credit_card",
	"cash",
	"investment",
	"wallet",
] as const;
export const TRANSACTION_TYPES = [
	"payment",
	"income",
	"transfer",
	"fee",
	"interest",
	"refund",
	"withdrawal",
	"deposit",
	"other",
] as const;
export const CATEGORY_KINDS = [
	"income",
	"expense",
	"transfer",
	"other",
] as const;
export const FREQUENCIES = [
	"weekly",
	"biweekly",
	"monthly",
	"bimonthly",
	"quarterly",
	"semiannual",
	"yearly",
	"custom",
] as const;
export const ASSET_CATEGORIES = [
	"real_estate",
	"vehicle",
	"watch",
	"collectible",
	"precious_metal",
	"inventory",
	"private_investment",
	"other",
] as const;
export const VALUATION_SOURCES = [
	"manual",
	"appraisal",
	"market",
	"purchase",
] as const;
export const LIABILITY_TYPES = [
	"credit_card",
	"personal_loan",
	"mortgage",
	"vehicle_finance",
	"other",
] as const;
export const DIRECTIONS = ["inflow", "outflow"] as const;
export const OPTIMIZATION_STATUSES = [
	"idea",
	"planned",
	"completed",
	"dismissed",
] as const;
export const OPTIMIZATION_CATEGORIES = [
	"banking",
	"subscription",
	"insurance",
	"utilities",
	"shopping",
	"mobility",
	"other",
] as const;
export const CONTRACT_CATEGORIES = [
	"insurance",
	"utilities",
	"telecom",
	"subscription",
	"banking",
	"housing",
	"mobility",
	"other",
] as const;
export const CONTRACT_STATUSES = ["active", "cancelled", "ended"] as const;
/** `payroll`: salary conversion (Entgeltumwandlung), paid by the employer. */
export const CONTRACT_PAID_VIA = ["account", "payroll"] as const;
export const CONTRACT_DOCUMENT_TYPES = [
	"contract",
	"policy",
	"invoice",
	"terms",
	"cancellation",
	"other",
] as const;
export const COPILOT_MEMORY_KINDS = ["preference", "rule", "fact"] as const;

export const AccountInput = v.object({
	name: shortText,
	institution: optionalText,
	type: v.picklist(ACCOUNT_TYPES),
	currency: currencyCode,
	iban: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(34)))),
	openingBalanceMinor: v.optional(minor, 0),
	openingBalanceDate: v.optional(isoDate),
	creditLimitMinor: v.optional(v.nullable(nonNegativeMinor)),
	includeInNetWorth: v.optional(v.boolean(), true),
	notes,
});
export const AccountUpdate = v.object({
	id,
	name: v.optional(shortText),
	institution: optionalText,
	type: v.optional(v.picklist(ACCOUNT_TYPES)),
	currency: v.optional(currencyCode),
	iban: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(34)))),
	creditLimitMinor: v.optional(v.nullable(nonNegativeMinor)),
	includeInNetWorth: v.optional(v.boolean()),
	isActive: v.optional(v.boolean()),
	notes,
});
export const BalanceInput = v.object({
	accountId: id,
	date: isoDate,
	balanceMinor: minor,
});
export const CashMovementInput = v.object({
	accountId: id,
	date: isoDate,
	amountMinor: v.pipe(
		minor,
		v.check((value) => value !== 0),
	),
	description: shortText,
	categoryId: optionalId,
	notes,
});

export const CopilotAskInput = v.object({
	question: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(2_000)),
	history: v.pipe(
		v.array(
			v.object({
				role: v.picklist(["user", "assistant"]),
				content: v.pipe(v.string(), v.minLength(1), v.maxLength(4_000)),
			}),
		),
		v.maxLength(10),
	),
	attachmentIds: v.optional(v.pipe(v.array(id), v.maxLength(8)), []),
});
export const CopilotMemoryInput = v.object({
	key: v.pipe(
		v.string(),
		v.trim(),
		v.toLowerCase(),
		v.regex(
			/^[a-z0-9][a-z0-9._-]{1,79}$/,
			"Kurzer stabiler Schlüssel erforderlich",
		),
	),
	kind: v.optional(v.picklist(COPILOT_MEMORY_KINDS), "fact"),
	content: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(2_000)),
});
export const CopilotMemoryUpdate = v.object({
	id,
	content: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(2_000)),
	kind: v.optional(v.picklist(COPILOT_MEMORY_KINDS)),
});

export const CategoryInput = v.object({
	name: shortText,
	kind: v.optional(v.picklist(CATEGORY_KINDS), "expense"),
	parentId: optionalId,
	icon: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(40)))),
	color: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(20)))),
});
export const CategoryUpdate = v.object({
	id,
	...v.partial(CategoryInput).entries,
});

export const RuleInput = v.object({
	name: shortText,
	priority: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10_000)),
		100,
	),
	isActive: v.optional(v.boolean(), true),
	descriptionContains: optionalText,
	merchantContains: optionalText,
	counterpartyIban: optionalText,
	amountMinMinor: v.optional(v.nullable(nonNegativeMinor)),
	amountMaxMinor: v.optional(v.nullable(nonNegativeMinor)),
	accountId: optionalId,
	direction: v.optional(v.nullable(v.picklist(DIRECTIONS))),
	categoryId: id,
	setMerchantName: optionalText,
});
export const RuleUpdate = v.object({ id, ...v.partial(RuleInput).entries });

export const TransactionFilter = v.object({
	accountId: optionalId,
	categoryId: optionalId,
	uncategorised: v.optional(v.boolean()),
	from: v.optional(isoDate),
	to: v.optional(isoDate),
	q: v.optional(v.pipe(v.string(), v.maxLength(200))),
	direction: v.optional(v.picklist(DIRECTIONS)),
	includeTransfers: v.optional(v.boolean(), true),
	recurringPaymentId: optionalId,
	merchantId: optionalId,
	status: v.optional(v.picklist(["pending", "booked"])),
	limit: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(500)),
		100,
	),
	offset: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0),
	sort: v.optional(
		v.picklist(["date_desc", "date_asc", "amount_desc", "amount_asc"]),
		"date_desc",
	),
});
export type TransactionFilterInput = v.InferInput<typeof TransactionFilter>;

export const TransactionInput = v.object({
	accountId: id,
	bookingDate: isoDate,
	valueDate: optionalIsoDate,
	amountMinor: minor,
	description: shortText,
	counterpartyName: optionalText,
	counterpartyIban: optionalText,
	categoryId: optionalId,
	type: v.optional(v.picklist(TRANSACTION_TYPES), "payment"),
	status: v.optional(v.picklist(["pending", "booked"]), "booked"),
	notes,
});
export const TransactionUpdate = v.object({
	id,
	categoryId: optionalId,
	merchantName: optionalText,
	notes,
	description: v.optional(shortText),
	bookingDate: v.optional(isoDate),
	amountMinor: v.optional(minor),
	status: v.optional(v.picklist(["pending", "booked"])),
	recurringPaymentId: optionalId,
	/** Also create a rule from this correction. */
	createRule: v.optional(v.boolean(), false),
});
export const TransferLink = v.object({ outflowId: id, inflowId: id });

export const RecurringInput = v.object({
	name: shortText,
	accountId: optionalId,
	categoryId: optionalId,
	direction: v.picklist(DIRECTIONS),
	expectedAmountMinor: minor,
	currency: currencyCode,
	frequency: v.picklist(FREQUENCIES),
	intervalDays: v.optional(
		v.nullable(
			v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(3660)),
		),
	),
	typicalDay: v.optional(
		v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(31))),
	),
	windowDays: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(60)),
		4,
	),
	nextExpected: optionalIsoDate,
	isActive: v.optional(v.boolean(), true),
	isSubscription: v.optional(v.boolean(), false),
	notes,
});
export const RecurringUpdate = v.object({
	id,
	...v.partial(RecurringInput).entries,
});

export const AssetInput = v.object({
	name: shortText,
	category: v.picklist(ASSET_CATEGORIES),
	currency: currencyCode,
	acquisitionDate: optionalIsoDate,
	acquisitionCostMinor: v.optional(v.nullable(nonNegativeMinor)),
	currentValueMinor: nonNegativeMinor,
	valuationDate: v.optional(isoDate),
	valuationSource: v.optional(v.picklist(VALUATION_SOURCES), "manual"),
	reference: optionalText,
	section: optionalText,
	notes,
});
export const AssetUpdate = v.object({
	id,
	name: v.optional(shortText),
	category: v.optional(v.picklist(ASSET_CATEGORIES)),
	acquisitionDate: optionalIsoDate,
	acquisitionCostMinor: v.optional(v.nullable(nonNegativeMinor)),
	reference: optionalText,
	section: optionalText,
	notes,
	isActive: v.optional(v.boolean()),
	disposedAt: optionalIsoDate,
});
export const ValuationInput = v.object({
	assetId: id,
	date: isoDate,
	valueMinor: nonNegativeMinor,
	source: v.optional(v.picklist(VALUATION_SOURCES), "manual"),
	notes,
});

export const LiabilityInput = v.object({
	name: shortText,
	type: v.picklist(LIABILITY_TYPES),
	lender: optionalText,
	currency: currencyCode,
	originalAmountMinor: v.optional(v.nullable(nonNegativeMinor)),
	currentBalanceMinor: nonNegativeMinor,
	balanceDate: v.optional(isoDate),
	interestRateBps: v.optional(
		v.nullable(
			v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100_000)),
		),
	),
	monthlyPaymentMinor: v.optional(v.nullable(nonNegativeMinor)),
	startDate: optionalIsoDate,
	endDate: optionalIsoDate,
	linkedAssetId: optionalId,
	linkedAccountId: optionalId,
	section: optionalText,
	notes,
});
export const LiabilityUpdate = v.object({
	id,
	...v.partial(v.omit(LiabilityInput, ["currentBalanceMinor", "balanceDate"]))
		.entries,
	isActive: v.optional(v.boolean()),
});
export const LiabilityBalanceInput = v.object({
	liabilityId: id,
	date: isoDate,
	balanceMinor: nonNegativeMinor,
});

export const ReceivableInput = v.object({
	name: shortText,
	debtorName: shortText,
	currency: currencyCode,
	originalAmountMinor: v.optional(v.nullable(nonNegativeMinor)),
	currentBalanceMinor: nonNegativeMinor,
	balanceDate: v.optional(isoDate),
	interestRateBps: v.optional(
		v.nullable(
			v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100_000)),
		),
	),
	monthlyPaymentMinor: v.optional(v.nullable(nonNegativeMinor)),
	startDate: optionalIsoDate,
	dueDate: optionalIsoDate,
	section: optionalText,
	notes,
});
export const ReceivableUpdate = v.object({
	id,
	...v.partial(v.omit(ReceivableInput, ["currentBalanceMinor", "balanceDate"]))
		.entries,
	isActive: v.optional(v.boolean()),
	settledAt: optionalIsoDate,
});
export const ReceivableBalanceInput = v.object({
	receivableId: id,
	date: isoDate,
	balanceMinor: nonNegativeMinor,
});

export const OptimizationInput = v.object({
	title: shortText,
	category: v.optional(v.picklist(OPTIMIZATION_CATEGORIES), "other"),
	currency: currencyCode,
	currentMonthlyMinor: nonNegativeMinor,
	alternativeMonthlyMinor: v.optional(nonNegativeMinor, 0),
	oneTimeCostMinor: v.optional(nonNegativeMinor, 0),
	status: v.optional(v.picklist(OPTIMIZATION_STATUSES), "idea"),
	targetDate: optionalIsoDate,
	completedAt: optionalIsoDate,
	savingFrom: optionalIsoDate,
	currentAccountId: optionalId,
	replacementAccountId: optionalId,
	recurringPaymentId: optionalId,
	contractId: optionalId,
	notes,
});
export const OptimizationUpdate = v.object({
	id,
	...v.partial(OptimizationInput).entries,
});

/**
 * The owner's picks from the batch review. `categoryId` is validated against
 * their own categories server-side; `rememberMerchants` only names merchants,
 * and which category each one gets is read back from the picked bookings so a
 * request cannot pin an arbitrary category onto a merchant.
 */
export const CategoryReviewApply = v.object({
	picks: v.pipe(
		v.array(v.object({ transactionId: id, categoryId: id })),
		v.maxLength(500),
	),
	rememberMerchants: v.optional(
		v.pipe(v.array(shortText), v.maxLength(200)),
		[],
	),
});

/**
 * Bookings to take back from Hr. Körner's auto-filing, bounded by what one
 * filing pass can file.
 */
export const DeskUnfile = v.object({
	transactionIds: v.pipe(v.array(id), v.minLength(1), v.maxLength(2_000)),
});

/** A month the recap is about, `YYYY-MM`. */
export const RecapMonth = v.object({
	month: v.pipe(
		v.string(),
		v.regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Format JJJJ-MM verwenden"),
	),
});

/** A turn in the categorisation conversation. */
export const CategoryConsult = v.object({
	sessionId: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(64)))),
	merchant: v.optional(v.pipe(v.string(), v.maxLength(200))),
	answer: v.optional(v.pipe(v.string(), v.maxLength(500))),
	/**
	 * Merchants the owner has already picked a category for in this sitting.
	 * Without them Hr. Körner keeps working on what is already decided, because
	 * the thread cannot see the choices made in the browser.
	 */
	resolved: v.optional(v.pipe(v.array(shortText), v.maxLength(400)), []),
});

/** A named access token for an AI client. */
export const McpTokenInput = v.object({
	name: shortText,
	scope: v.optional(v.picklist(["read", "read_write"]), "read"),
});

export const ContractInput = v.object({
	name: shortText,
	provider: optionalText,
	contractNumber: optionalText,
	category: v.optional(v.picklist(CONTRACT_CATEGORIES), "other"),
	status: v.optional(v.picklist(CONTRACT_STATUSES), "active"),
	costMinor: v.optional(v.nullable(nonNegativeMinor)),
	currency: v.optional(currencyCode, "EUR"),
	frequency: v.optional(v.nullable(v.picklist(FREQUENCIES))),
	startDate: optionalIsoDate,
	endDate: optionalIsoDate,
	cancellationDate: optionalIsoDate,
	renewalDate: optionalIsoDate,
	noticePeriodDays: v.optional(
		v.nullable(
			v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(3650)),
		),
	),
	accountId: optionalId,
	recurringPaymentId: optionalId,
	paidVia: v.optional(v.picklist(CONTRACT_PAID_VIA), "account"),
	notes,
});
export const ContractUpdate = v.object({
	id,
	...v.partial(ContractInput).entries,
});
export const ContractDocumentInput = v.object({
	contractId: id,
	attachmentId: id,
	type: v.optional(v.picklist(CONTRACT_DOCUMENT_TYPES), "other"),
});

export const RecapInput = v.object({
	metric: v.optional(
		v.picklist(["net_worth", "assets", "investable", "cash", "liabilities"]),
		"net_worth",
	),
	interval: v.optional(
		v.picklist(["monthly", "quarterly", "yearly"]),
		"monthly",
	),
	months: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(3), v.maxValue(120)),
		24,
	),
	mode: v.optional(v.picklist(["totals", "change"]), "totals"),
});

const orderIsin = v.pipe(
	v.string(),
	v.regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/, "ISIN ist ungültig"),
);
/** One market order at Scalable; no amount limit by the owner's decision. */
export const BrokerOrderPreview = v.variant("side", [
	v.object({
		side: v.literal("buy"),
		isin: orderIsin,
		amountMinor: v.pipe(v.number(), v.integer(), v.minValue(100)),
	}),
	v.object({
		side: v.literal("sell"),
		isin: orderIsin,
		shares: v.pipe(v.number(), v.gtValue(0), v.maxValue(1e9)),
		/** "Warum jetzt?": one sentence of the owner's own, before any preview. */
		reason: v.pipe(
			v.string(),
			v.maxLength(SELL_REASON_MAX * 2),
			v.check(
				(reason) => sellReasonProblem(reason) === null,
				"Bitte in einem Satz notieren, warum Sie jetzt verkaufen.",
			),
		),
	}),
]);

export const BrokerOrderSubmit = v.object({
	orderId: id,
	acknowledged: v.boolean(),
});

export const BrokerOrderId = v.object({ orderId: id });

export const SettingsUpdate = v.object({
	baseCurrency: v.optional(currencyCode),
	locale: v.optional(
		v.picklist(["en-GB", "en-US", "de-DE", "de-CH", "de-AT", "fr-FR", "nl-NL"]),
	),
	analysisMonths: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(3), v.maxValue(60)),
	),
	hiddenNavItems: v.optional(
		v.pipe(v.array(v.pipe(v.string(), v.maxLength(64))), v.maxLength(30)),
	),
});
export const FxRateInput = v.object({
	date: isoDate,
	base: currencyCode,
	quote: currencyCode,
	rate: v.pipe(v.number(), v.minValue(0)),
});

export const CsvPreviewInput = v.object({
	accountId: id,
	fileName: v.pipe(v.string(), v.maxLength(200)),
	content: v.pipe(v.string(), v.maxLength(5_000_000)),
});
const CsvMappingFields = v.object({
	bookingDate: v.number(),
	valueDate: v.optional(v.number()),
	amount: v.optional(v.number()),
	debit: v.optional(v.number()),
	credit: v.optional(v.number()),
	description: v.number(),
	counterpartyName: v.optional(v.number()),
	counterpartyIban: v.optional(v.number()),
	currency: v.optional(v.number()),
	externalId: v.optional(v.number()),
	dateFormat: v.picklist(["iso", "dmy", "mdy"]),
});
export const CsvMapping = v.pipe(
	CsvMappingFields,
	v.check(
		(mapping) =>
			mapping.amount !== undefined ||
			(mapping.debit !== undefined && mapping.credit !== undefined),
		"Entweder Betrag oder Soll und Haben zuordnen",
	),
);
export const CsvCommitInput = v.object({
	...CsvPreviewInput.entries,
	mapping: CsvMapping,
	hasHeader: v.optional(v.boolean(), true),
});

export const PeriodInput = v.object({
	from: v.optional(isoDate),
	to: v.optional(isoDate),
	months: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(120)),
	),
});
export const ForecastInput = v.object({
	horizonDays: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(7), v.maxValue(365)),
		90,
	),
	accountIds: v.optional(v.array(id)),
});
export const SearchInput = v.object({
	q: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
	limit: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50)),
		8,
	),
});
export const IdInput = v.object({ id });
