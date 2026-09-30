import { relations, sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	date,
	index,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

// Conventions
// - Money is stored as integer minor units (cents) in `*_minor` bigint columns,
//   never as floating point. Quantities and unit prices are numeric.
// - Every amount carries its own currency; nothing is summed across currencies
//   without going through the FX service.
// - History tables (account_balances, asset_valuations, liability_balances,
//   security_prices) are the source of truth for "value at date"; the current
//   value on the parent row is a denormalised convenience kept in sync by the
//   services.
// - All domain rows are scoped to a user id so the model stays correct if a
//   second person ever uses the same deployment.

const money = (name: string) => bigint(name, { mode: "number" });
const timestamps = {
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
};
const id = () => text("id").primaryKey().default(sql`gen_random_uuid()`);

export const accountTypeEnum = pgEnum("account_type", [
	"current",
	"savings",
	"credit_card",
	"cash",
	"investment",
	// A payment service holding a balance — PayPal and the like. Liquid like a
	// current account and counted the same way, but calling it a Girokonto is
	// simply wrong, and the owner reads the label.
	"wallet",
]);
export const syncStatusEnum = pgEnum("sync_status", [
	"manual",
	"synced",
	"pending",
	"error",
	"disconnected",
]);
export const transactionTypeEnum = pgEnum("transaction_type", [
	"payment",
	"income",
	"transfer",
	"fee",
	"interest",
	"refund",
	"withdrawal",
	"deposit",
	"other",
]);
export const transactionStatusEnum = pgEnum("transaction_status", [
	"pending",
	"booked",
]);
export const categoryKindEnum = pgEnum("category_kind", [
	"income",
	"expense",
	"transfer",
	"other",
]);
export const mcpScopeEnum = pgEnum("mcp_scope", ["read", "read_write"]);
export const categorySourceEnum = pgEnum("category_source", [
	"manual",
	"rule",
	"import",
	"recurring",
	"ai",
	// Filed by Hr. Körner on his own because it repeats a decision the owner
	// already made (rule, recurring payment, merchant default, unbroken
	// history). Rules and detection may overwrite it; an owner edit makes it
	// manual, and the desk can undo it while it is still exactly this.
	"auto",
]);
export const directionEnum = pgEnum("direction", ["inflow", "outflow"]);
export const frequencyEnum = pgEnum("frequency", [
	"weekly",
	"biweekly",
	"monthly",
	"bimonthly",
	"quarterly",
	"semiannual",
	"yearly",
	"custom",
]);
export const assetCategoryEnum = pgEnum("asset_category", [
	"real_estate",
	"vehicle",
	"watch",
	"collectible",
	"precious_metal",
	"inventory",
	"private_investment",
	"other",
]);
export const valuationSourceEnum = pgEnum("valuation_source", [
	"manual",
	"appraisal",
	"market",
	"purchase",
]);
export const liabilityTypeEnum = pgEnum("liability_type", [
	"credit_card",
	"personal_loan",
	"mortgage",
	"vehicle_finance",
	"other",
]);
export const securityTypeEnum = pgEnum("security_type", [
	"etf",
	"stock",
	"bond",
	"fund",
	"crypto",
	"other",
]);
export const investmentAssetClassEnum = pgEnum("investment_asset_class", [
	"global_equity",
	"regional_equity",
	"single_stock",
	"bonds",
	"money_market",
	"real_assets",
	"speculative",
	"other",
]);
export const priceSourceEnum = pgEnum("price_source", ["manual", "provider"]);
export const importKindEnum = pgEnum("import_kind", ["csv", "provider_sync"]);
export const importStatusEnum = pgEnum("import_status", [
	"completed",
	"failed",
	"partial",
]);
export const connectionStatusEnum = pgEnum("connection_status", [
	"pending",
	"active",
	"expired",
	"error",
	"disconnected",
]);
export const optimizationStatusEnum = pgEnum("optimization_status", [
	"idea",
	"planned",
	"completed",
	"dismissed",
]);
export const optimizationCategoryEnum = pgEnum("optimization_category", [
	"banking",
	"subscription",
	"insurance",
	"utilities",
	"shopping",
	"mobility",
	"other",
]);
export const contractCategoryEnum = pgEnum("contract_category", [
	"insurance",
	"utilities",
	"telecom",
	"subscription",
	"banking",
	"housing",
	"mobility",
	"other",
]);
export const contractStatusEnum = pgEnum("contract_status", [
	"active",
	"cancelled",
	"ended",
]);
/**
 * Who pays a contract. `payroll` is salary conversion (Entgeltumwandlung): the
 * employer pays it out of gross pay, so it never leaves a bank account and is
 * not a fixed cost there.
 */
export const contractPaidViaEnum = pgEnum("contract_paid_via", [
	"account",
	"payroll",
]);
export const contractDocumentTypeEnum = pgEnum("contract_document_type", [
	"contract",
	"policy",
	"invoice",
	"terms",
	"cancellation",
	"other",
]);
export const scenarioRuleTypeEnum = pgEnum("scenario_rule_type", [
	"growth",
	"recurring_income",
	"recurring_expense",
	"one_time_income",
	"one_time_expense",
	"debt_repayment",
]);
export const scenarioTargetEnum = pgEnum("scenario_target", [
	"cash",
	"investments",
	"physical",
	"receivables",
	"liabilities",
]);
export const copilotMemoryKindEnum = pgEnum("copilot_memory_kind", [
	"preference",
	"rule",
	"fact",
]);
export const observationSeverityEnum = pgEnum("observation_severity", [
	"info",
	"notable",
	"review",
	"urgent",
]);
export const observationStatusEnum = pgEnum("observation_status", [
	"open",
	"dismissed",
	"intentional",
	"snoozed",
	"resolved",
]);

export const userSettings = pgTable("user_settings", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	baseCurrency: text("base_currency").default("EUR").notNull(),
	locale: text("locale").default("de-DE").notNull(),
	// Rolling window (months) for cashflow averages and recurring detection.
	analysisMonths: integer("analysis_months").default(12).notNull(),
	hiddenNavItems: jsonb("hidden_nav_items")
		.$type<string[]>()
		.default([])
		.notNull(),
	...timestamps,
});

export const bankConnections = pgTable(
	"bank_connections",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		provider: text("provider").notNull(),
		providerConnectionId: text("provider_connection_id"),
		institutionName: text("institution_name").notNull(),
		// An institution is identified by name AND country: the PSU-header
		// lookup before every sync needs both, and everything connected before
		// the picker showed other countries was German.
		institutionCountry: text("institution_country").default("DE").notNull(),
		status: connectionStatusEnum("status").default("active").notNull(),
		// AES-GCM encrypted provider credentials/tokens; never returned to clients.
		encryptedSecret: text("encrypted_secret"),
		consentExpiresAt: timestamp("consent_expires_at", { withTimezone: true }),
		lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
		automaticRetryAt: timestamp("automatic_retry_at", { withTimezone: true }),
		lastError: text("last_error"),
		...timestamps,
	},
	(t) => [index("bank_connections_user_idx").on(t.userId)],
);

export const providerCredentials = pgTable(
	"provider_credentials",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		provider: text("provider").notNull(),
		applicationId: text("application_id").notNull(),
		// Encrypted server-side before storage and never returned to clients.
		encryptedPrivateKey: text("encrypted_private_key").notNull(),
		keyFingerprint: text("key_fingerprint").notNull(),
		...timestamps,
	},
	(t) => [
		uniqueIndex("provider_credentials_user_provider_unique").on(
			t.userId,
			t.provider,
		),
	],
);

export const externalConnections = pgTable(
	"external_connections",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		provider: text("provider").notNull(),
		providerConnectionId: text("provider_connection_id"),
		clientId: text("client_id"),
		status: connectionStatusEnum("status").default("pending").notNull(),
		// OAuth access and refresh tokens plus temporary PKCE state.
		encryptedSecret: text("encrypted_secret"),
		lastAttemptedSyncAt: timestamp("last_attempted_sync_at", {
			withTimezone: true,
		}),
		lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
		lastError: text("last_error"),
		...timestamps,
	},
	(t) => [
		uniqueIndex("external_connections_user_provider_unique").on(
			t.userId,
			t.provider,
		),
	],
);

export const contracts = pgTable(
	"contracts",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		provider: text("provider"),
		contractNumber: text("contract_number"),
		category: contractCategoryEnum("category").default("other").notNull(),
		status: contractStatusEnum("status").default("active").notNull(),
		costMinor: money("cost_minor"),
		currency: text("currency").default("EUR").notNull(),
		frequency: frequencyEnum("frequency"),
		startDate: date("start_date"),
		endDate: date("end_date"),
		cancellationDate: date("cancellation_date"),
		renewalDate: date("renewal_date"),
		noticePeriodDays: integer("notice_period_days"),
		accountId: text("account_id").references(() => accounts.id, {
			onDelete: "set null",
		}),
		recurringPaymentId: text("recurring_payment_id").references(
			() => recurringPayments.id,
			{ onDelete: "set null" },
		),
		paidVia: contractPaidViaEnum("paid_via").default("account").notNull(),
		notes: text("notes"),
		...timestamps,
	},
	(t) => [index("contracts_user_idx").on(t.userId, t.status)],
);

export const contractDocuments = pgTable(
	"contract_documents",
	{
		id: id(),
		contractId: text("contract_id")
			.notNull()
			.references(() => contracts.id, { onDelete: "cascade" }),
		type: contractDocumentTypeEnum("type").default("other").notNull(),
		fileName: text("file_name").notNull(),
		mimeType: text("mime_type").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		sha256: text("sha256").notNull(),
		// Existing documents may remain here until object storage is configured.
		encryptedContent: text("encrypted_content"),
		// New documents use encrypted S3-compatible object storage when available.
		storageKey: text("storage_key"),
		encryptedExtractedText: text("encrypted_extracted_text"),
		createdAt: timestamps.createdAt,
	},
	(t) => [
		index("contract_documents_contract_idx").on(t.contractId),
		// attachContractDocument dedupes on this pair by reading first, which two
		// uploads can both pass. The dev database already carried this index from
		// a migration that was never committed; production did not.
		uniqueIndex("contract_documents_contract_sha_unique").on(
			t.contractId,
			t.sha256,
		),
	],
);

// Unused since 0.59.0; dropped in a follow-up after the owner confirms.
export const scenarios = pgTable(
	"scenarios",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description"),
		horizonYears: integer("horizon_years").default(10).notNull(),
		inflationBps: integer("inflation_bps").default(200).notNull(),
		isActive: boolean("is_active").default(true).notNull(),
		...timestamps,
	},
	(t) => [index("scenarios_user_idx").on(t.userId, t.isActive)],
);

// Unused since 0.59.0; dropped in a follow-up after the owner confirms.
export const scenarioRules = pgTable(
	"scenario_rules",
	{
		id: id(),
		scenarioId: text("scenario_id")
			.notNull()
			.references(() => scenarios.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		type: scenarioRuleTypeEnum("type").notNull(),
		target: scenarioTargetEnum("target"),
		amountMinor: money("amount_minor"),
		annualRateBps: integer("annual_rate_bps"),
		frequency: frequencyEnum("frequency"),
		startDate: date("start_date"),
		endDate: date("end_date"),
		eventDate: date("event_date"),
		sortOrder: integer("sort_order").default(0).notNull(),
		createdAt: timestamps.createdAt,
	},
	(t) => [index("scenario_rules_scenario_idx").on(t.scenarioId)],
);

export const copilotMemories = pgTable(
	"copilot_memories",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		// Stable machine key so a later correction replaces the old memory.
		key: text("key").notNull(),
		kind: copilotMemoryKindEnum("kind").default("fact").notNull(),
		content: text("content").notNull(),
		lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		...timestamps,
	},
	(t) => [
		uniqueIndex("copilot_memories_user_key_unique").on(t.userId, t.key),
		index("copilot_memories_user_idx").on(t.userId, t.updatedAt),
	],
);

export const copilotThreads = pgTable("copilot_threads", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	threadId: text("thread_id").notNull(),
	toolsetVersion: integer("toolset_version").default(1).notNull(),
	...timestamps,
});

// Explicit owner preferences, separate from free-form Copilot memories.
export const financialProfiles = pgTable("financial_profiles", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	currency: text("currency").default("EUR").notNull(),
	minimumCashReserveMinor: money("minimum_cash_reserve_minor"),
	targetNetWorthMinor: money("target_net_worth_minor"),
	targetNetWorthDate: date("target_net_worth_date"),
	monthlySavingsTargetMinor: money("monthly_savings_target_minor"),
	/**
	 * The one goal: its name, and `target_net_worth_*` as amount and date.
	 * Reserve months and the target split live here too, since 0.59.0 the only
	 * place the "Anlegen" flow, the desk and Hr. Körner read them from.
	 */
	goalName: text("goal_name"),
	reserveMonths: integer("reserve_months").default(3).notNull(),
	targetEquityBps: integer("target_equity_bps").default(7000).notNull(),
	targetBondBps: integer("target_bond_bps").default(2000).notNull(),
	targetCashBps: integer("target_cash_bps").default(1000).notNull(),
	targetOtherBps: integer("target_other_bps").default(0).notNull(),
	largePurchaseThresholdMinor: money("large_purchase_threshold_minor"),
	unusualSpendMultiplierBps: integer("unusual_spend_multiplier_bps")
		.default(25000)
		.notNull(),
	alertSensitivity: text("alert_sensitivity").default("balanced").notNull(),
	ignoredCategoryIds: jsonb("ignored_category_ids")
		.$type<string[]>()
		.default([])
		.notNull(),
	weeklyReportEnabled: boolean("weekly_report_enabled").default(true).notNull(),
	/**
	 * The owner's own investment rules, in their words (at most 2,000
	 * characters). Shown before a sale; session-only, never given to the
	 * Copilot or an MCP client.
	 */
	investmentRules: text("investment_rules"),
	...timestamps,
});

export const financialObservations = pgTable(
	"financial_observations",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		key: text("key").notNull(),
		type: text("type").notNull(),
		severity: observationSeverityEnum("severity").notNull(),
		status: observationStatusEnum("status").default("open").notNull(),
		title: text("title").notNull(),
		explanation: text("explanation").notNull(),
		evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
		sourceEntities: jsonb("source_entities").$type<string[]>().notNull(),
		currency: text("currency"),
		impactMinor: money("impact_minor"),
		confidence: text("confidence").notNull(),
		periodStart: date("period_start"),
		periodEnd: date("period_end"),
		actionable: boolean("actionable").default(false).notNull(),
		firstDetectedAt: timestamp("first_detected_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		lastDetectedAt: timestamp("last_detected_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
		resolvedAt: timestamp("resolved_at", { withTimezone: true }),
		snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
		...timestamps,
	},
	(t) => [
		uniqueIndex("financial_observations_user_key_unique").on(t.userId, t.key),
		index("financial_observations_user_status_idx").on(t.userId, t.status),
	],
);

/**
 * The month recaps the owner has read on the desk, one row per month
 * (`YYYY-MM`, the month the recap is about). Reading it is the only thing
 * that takes the card off the desk before the first days of the month pass.
 */
export const deskRecapReads = pgTable(
	"desk_recap_reads",
	{
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		month: text("month").notNull(),
		readAt: timestamp("read_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(t) => [
		uniqueIndex("desk_recap_reads_user_month_unique").on(t.userId, t.month),
	],
);

export const financialReviewRuns = pgTable("financial_review_runs", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
	lastSucceededAt: timestamp("last_succeeded_at", { withTimezone: true }),
	lastErrorClass: text("last_error_class"),
});

export const accounts = pgTable(
	"accounts",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		institution: text("institution"),
		type: accountTypeEnum("type").notNull(),
		currency: text("currency").notNull(),
		iban: text("iban"),
		currentBalanceMinor: money("current_balance_minor").default(0).notNull(),
		balanceAsOf: date("balance_as_of"),
		isActive: boolean("is_active").default(true).notNull(),
		includeInNetWorth: boolean("include_in_net_worth").default(true).notNull(),
		syncStatus: syncStatusEnum("sync_status").default("manual").notNull(),
		bankConnectionId: text("bank_connection_id").references(
			() => bankConnections.id,
			{ onDelete: "set null" },
		),
		providerAccountId: text("provider_account_id"),
		// A stable identity for the account at the provider, unlike
		// `provider_account_id`, which an Enable Banking session invalidates on
		// every renewal. Normally the IBAN; for an account that has none — a
		// PayPal account is identified by an email under scheme OTHI — the
		// provider's other identification. Without it a renewed consent cannot
		// recognise the account and creates a second one beside it.
		providerAccountRef: text("provider_account_ref"),
		// Credit limit for credit cards, in minor units.
		creditLimitMinor: money("credit_limit_minor"),
		notes: text("notes"),
		sortOrder: integer("sort_order").default(0).notNull(),
		...timestamps,
	},
	(t) => [
		index("accounts_user_idx").on(t.userId),
		uniqueIndex("accounts_provider_unique")
			.on(t.bankConnectionId, t.providerAccountId)
			.where(sql`${t.providerAccountId} is not null`),
		// One IBAN is one account. Without this the bank sync could add a second
		// row for an account already held manually, and both balances would be
		// counted in net worth. Verified empty before the index was introduced.
		uniqueIndex("accounts_iban_unique")
			.on(t.userId, sql`upper(replace(${t.iban}, ' ', ''))`, t.currency)
			.where(sql`${t.iban} is not null`),
	],
);

export const accountBalances = pgTable(
	"account_balances",
	{
		id: id(),
		accountId: text("account_id")
			.notNull()
			.references(() => accounts.id, { onDelete: "cascade" }),
		date: date("date").notNull(),
		balanceMinor: money("balance_minor").notNull(),
		source: text("source").default("manual").notNull(),
		createdAt: timestamps.createdAt,
	},
	(t) => [uniqueIndex("account_balances_account_date").on(t.accountId, t.date)],
);

// Unused since 0.59.0; dropped in a follow-up after the owner confirms.
export const accountProjections = pgTable("account_projections", {
	accountId: text("account_id")
		.primaryKey()
		.references(() => accounts.id, { onDelete: "cascade" }),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	monthlyContributionMinor: money("monthly_contribution_minor")
		.default(0)
		.notNull(),
	contributionShareBps: integer("contribution_share_bps")
		.default(10000)
		.notNull(),
	cautiousReturnBps: integer("cautious_return_bps").default(100).notNull(),
	expectedReturnBps: integer("expected_return_bps").default(300).notNull(),
	optimisticReturnBps: integer("optimistic_return_bps").default(500).notNull(),
	horizonYears: integer("horizon_years").default(10).notNull(),
	...timestamps,
});

export const categories = pgTable(
	"categories",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		slug: text("slug").notNull(),
		kind: categoryKindEnum("kind").default("expense").notNull(),
		parentId: text("parent_id"),
		icon: text("icon"),
		color: text("color"),
		isSystem: boolean("is_system").default(false).notNull(),
		sortOrder: integer("sort_order").default(0).notNull(),
		...timestamps,
	},
	(t) => [
		uniqueIndex("categories_user_slug").on(t.userId, t.slug),
		index("categories_parent_idx").on(t.parentId),
	],
);

/**
 * Access tokens for AI clients talking to the MCP endpoint.
 *
 * The static MCP_BEARER_TOKEN cannot be revoked, cannot be scoped and cannot
 * be told apart from another client using the same value. A token that may
 * write needs all three, so these are stored hashed, named, and revocable.
 */
export const mcpTokens = pgTable(
	"mcp_tokens",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** What the owner called it, e.g. "Claude Code auf dem MacBook". */
		name: text("name").notNull(),
		/** SHA-256 of the token. The token itself is shown once and never kept. */
		tokenHash: text("token_hash").notNull(),
		scope: mcpScopeEnum("scope").default("read").notNull(),
		lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		...timestamps,
	},
	(t) => [
		uniqueIndex("mcp_tokens_hash").on(t.tokenHash),
		index("mcp_tokens_user_idx").on(t.userId),
	],
);

export const merchants = pgTable(
	"merchants",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		normalizedName: text("normalized_name").notNull(),
		defaultCategoryId: text("default_category_id").references(
			() => categories.id,
			{ onDelete: "set null" },
		),
		website: text("website"),
		...timestamps,
	},
	(t) => [
		uniqueIndex("merchants_user_normalized").on(t.userId, t.normalizedName),
	],
);

export const categorizationRules = pgTable(
	"categorization_rules",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		priority: integer("priority").default(100).notNull(),
		isActive: boolean("is_active").default(true).notNull(),
		// Match conditions; all set conditions must hold (AND).
		descriptionContains: text("description_contains"),
		merchantContains: text("merchant_contains"),
		counterpartyIban: text("counterparty_iban"),
		amountMinMinor: money("amount_min_minor"),
		amountMaxMinor: money("amount_max_minor"),
		accountId: text("account_id").references(() => accounts.id, {
			onDelete: "cascade",
		}),
		direction: directionEnum("direction"),
		// Effects
		categoryId: text("category_id")
			.notNull()
			.references(() => categories.id, { onDelete: "cascade" }),
		setMerchantName: text("set_merchant_name"),
		matchCount: integer("match_count").default(0).notNull(),
		...timestamps,
	},
	(t) => [index("categorization_rules_user_idx").on(t.userId, t.priority)],
);

export const recurringPayments = pgTable(
	"recurring_payments",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		merchantId: text("merchant_id").references(() => merchants.id, {
			onDelete: "set null",
		}),
		categoryId: text("category_id").references(() => categories.id, {
			onDelete: "set null",
		}),
		accountId: text("account_id").references(() => accounts.id, {
			onDelete: "set null",
		}),
		direction: directionEnum("direction").notNull(),
		expectedAmountMinor: money("expected_amount_minor").notNull(),
		// What it used to cost, and since when it costs the current amount.
		// Detection used to overwrite the amount in silence, so a subscription
		// getting more expensive was something the owner simply never learnt.
		previousAmountMinor: money("previous_amount_minor"),
		priceChangedAt: date("price_changed_at"),
		currency: text("currency").notNull(),
		frequency: frequencyEnum("frequency").notNull(),
		intervalDays: integer("interval_days"),
		// Typical booking day (day of month) and tolerance around it in days.
		typicalDay: integer("typical_day"),
		windowDays: integer("window_days").default(4).notNull(),
		lastOccurrence: date("last_occurrence"),
		nextExpected: date("next_expected"),
		isActive: boolean("is_active").default(true).notNull(),
		isSubscription: boolean("is_subscription").default(false).notNull(),
		detectedAutomatically: boolean("detected_automatically")
			.default(false)
			.notNull(),
		// Normalised merchant key the detector groups by; used to re-link imports.
		matchKey: text("match_key"),
		notes: text("notes"),
		...timestamps,
	},
	(t) => [
		index("recurring_user_idx").on(t.userId, t.isActive),
		// Detection checks for an existing match key in application code, which
		// two concurrent runs can both pass. A duplicate would be counted twice
		// in the forecast and in the subscription total.
		uniqueIndex("recurring_match_key_unique")
			.on(t.userId, t.matchKey)
			.where(sql`${t.matchKey} is not null`),
	],
);

export const optimizations = pgTable(
	"optimizations",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		category: optimizationCategoryEnum("category").default("other").notNull(),
		currency: text("currency").default("EUR").notNull(),
		currentMonthlyMinor: money("current_monthly_minor").notNull(),
		alternativeMonthlyMinor: money("alternative_monthly_minor")
			.default(0)
			.notNull(),
		oneTimeCostMinor: money("one_time_cost_minor").default(0).notNull(),
		status: optimizationStatusEnum("status").default("idea").notNull(),
		targetDate: date("target_date"),
		completedAt: date("completed_at"),
		// The day the old cost stops when no contract is linked to say so. The
		// day the mission was ticked off is not it: a cancelled subscription is
		// still charged until its paid period ends.
		savingFrom: date("saving_from"),
		currentAccountId: text("current_account_id").references(() => accounts.id, {
			onDelete: "set null",
		}),
		replacementAccountId: text("replacement_account_id").references(
			() => accounts.id,
			{ onDelete: "set null" },
		),
		recurringPaymentId: text("recurring_payment_id").references(
			() => recurringPayments.id,
			{ onDelete: "set null" },
		),
		// The contract being replaced. It owns the dates: a cancelled contract
		// still costs its old price until it ends, so that is when the saving
		// actually begins — not the day the mission was ticked off.
		contractId: text("contract_id").references(() => contracts.id, {
			onDelete: "set null",
		}),
		notes: text("notes"),
		...timestamps,
	},
	(t) => [
		index("optimizations_user_status_idx").on(t.userId, t.status),
		uniqueIndex("optimizations_user_recurring_unique")
			.on(t.userId, t.recurringPaymentId)
			.where(sql`${t.recurringPaymentId} is not null`),
	],
);

export const importJobs = pgTable(
	"import_jobs",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		kind: importKindEnum("kind").notNull(),
		accountId: text("account_id").references(() => accounts.id, {
			onDelete: "set null",
		}),
		bankConnectionId: text("bank_connection_id").references(
			() => bankConnections.id,
			{ onDelete: "set null" },
		),
		fileName: text("file_name"),
		status: importStatusEnum("status").notNull(),
		totalRows: integer("total_rows").default(0).notNull(),
		importedRows: integer("imported_rows").default(0).notNull(),
		duplicateRows: integer("duplicate_rows").default(0).notNull(),
		errorRows: integer("error_rows").default(0).notNull(),
		log: jsonb("log").$type<string[]>().default([]).notNull(),
		createdAt: timestamps.createdAt,
	},
	(t) => [index("import_jobs_user_idx").on(t.userId, t.createdAt)],
);

export const transactions = pgTable(
	"transactions",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accountId: text("account_id")
			.notNull()
			.references(() => accounts.id, { onDelete: "cascade" }),
		bookingDate: date("booking_date").notNull(),
		valueDate: date("value_date"),
		// Signed: negative = money leaves the account.
		amountMinor: money("amount_minor").notNull(),
		currency: text("currency").notNull(),
		description: text("description").notNull(),
		counterpartyName: text("counterparty_name"),
		counterpartyIban: text("counterparty_iban"),
		merchantId: text("merchant_id").references(() => merchants.id, {
			onDelete: "set null",
		}),
		merchantName: text("merchant_name"),
		categoryId: text("category_id").references(() => categories.id, {
			onDelete: "set null",
		}),
		categorySource: categorySourceEnum("category_source"),
		type: transactionTypeEnum("type").default("payment").notNull(),
		status: transactionStatusEnum("status").default("booked").notNull(),
		// Both legs of an internal transfer share a transfer group id.
		transferGroupId: text("transfer_group_id"),
		recurringPaymentId: text("recurring_payment_id").references(
			() => recurringPayments.id,
			{ onDelete: "set null" },
		),
		notes: text("notes"),
		externalId: text("external_id"),
		importSource: text("import_source").default("manual").notNull(),
		importJobId: text("import_job_id").references(() => importJobs.id, {
			onDelete: "set null",
		}),
		// Deterministic hash of account + date + amount + normalised description
		// used to reject re-imports of the same row when no external id exists.
		fingerprint: text("fingerprint").notNull(),
		...timestamps,
	},
	(t) => [
		index("transactions_user_date_idx").on(t.userId, t.bookingDate),
		index("transactions_account_date_idx").on(t.accountId, t.bookingDate),
		index("transactions_category_idx").on(t.categoryId),
		index("transactions_recurring_idx").on(t.recurringPaymentId),
		index("transactions_transfer_idx").on(t.transferGroupId),
		// Merchant search and the merchant filter both scan by this alone.
		index("transactions_merchant_idx").on(t.merchantId),
		uniqueIndex("transactions_account_fingerprint").on(
			t.accountId,
			t.fingerprint,
		),
		uniqueIndex("transactions_account_external")
			.on(t.accountId, t.externalId)
			.where(sql`${t.externalId} is not null`),
	],
);

// Unused since 0.59.0; dropped in a follow-up after the owner confirms.
export const budgets = pgTable(
	"budgets",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		categoryId: text("category_id")
			.notNull()
			.references(() => categories.id, { onDelete: "cascade" }),
		amountMinor: money("amount_minor").notNull(),
		currency: text("currency").notNull(),
		// Budgets are monthly; `startMonth` (YYYY-MM-01) is the first month it
		// applies to.
		startMonth: date("start_month").notNull(),
		endMonth: date("end_month"),
		...timestamps,
	},
	(t) => [
		uniqueIndex("budgets_user_category_start").on(
			t.userId,
			t.categoryId,
			t.startMonth,
		),
	],
);

export const assets = pgTable(
	"assets",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		category: assetCategoryEnum("category").notNull(),
		currency: text("currency").notNull(),
		acquisitionDate: date("acquisition_date"),
		acquisitionCostMinor: money("acquisition_cost_minor"),
		currentValueMinor: money("current_value_minor").default(0).notNull(),
		valuationDate: date("valuation_date"),
		reference: text("reference"),
		// Stable provider identity. User-facing names and grouping stay editable.
		syncSource: text("sync_source"),
		externalId: text("external_id"),
		// User-defined grouping on the assets sheet (e.g. "Watches", "Cars").
		section: text("section"),
		notes: text("notes"),
		isActive: boolean("is_active").default(true).notNull(),
		disposedAt: date("disposed_at"),
		...timestamps,
	},
	(t) => [
		index("assets_user_idx").on(t.userId),
		uniqueIndex("assets_external_unique")
			.on(t.userId, t.syncSource, t.externalId)
			.where(sql`${t.syncSource} is not null and ${t.externalId} is not null`),
	],
);

export const assetValuations = pgTable(
	"asset_valuations",
	{
		id: id(),
		assetId: text("asset_id")
			.notNull()
			.references(() => assets.id, { onDelete: "cascade" }),
		date: date("date").notNull(),
		valueMinor: money("value_minor").notNull(),
		source: valuationSourceEnum("source").default("manual").notNull(),
		notes: text("notes"),
		createdAt: timestamps.createdAt,
	},
	(t) => [uniqueIndex("asset_valuations_asset_date").on(t.assetId, t.date)],
);

export const liabilities = pgTable(
	"liabilities",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		type: liabilityTypeEnum("type").notNull(),
		lender: text("lender"),
		currency: text("currency").notNull(),
		originalAmountMinor: money("original_amount_minor"),
		currentBalanceMinor: money("current_balance_minor").default(0).notNull(),
		balanceAsOf: date("balance_as_of"),
		// Basis points: 3.25% = 325.
		interestRateBps: integer("interest_rate_bps"),
		monthlyPaymentMinor: money("monthly_payment_minor"),
		startDate: date("start_date"),
		endDate: date("end_date"),
		linkedAssetId: text("linked_asset_id").references(() => assets.id, {
			onDelete: "set null",
		}),
		// A credit-card liability mirrors a credit-card account; net worth then
		// takes the balance from the account and this row only carries terms.
		linkedAccountId: text("linked_account_id").references(() => accounts.id, {
			onDelete: "set null",
		}),
		section: text("section"),
		isActive: boolean("is_active").default(true).notNull(),
		notes: text("notes"),
		...timestamps,
	},
	(t) => [index("liabilities_user_idx").on(t.userId)],
);

export const liabilityBalances = pgTable(
	"liability_balances",
	{
		id: id(),
		liabilityId: text("liability_id")
			.notNull()
			.references(() => liabilities.id, { onDelete: "cascade" }),
		date: date("date").notNull(),
		balanceMinor: money("balance_minor").notNull(),
		createdAt: timestamps.createdAt,
	},
	(t) => [
		uniqueIndex("liability_balances_liability_date").on(t.liabilityId, t.date),
	],
);

export const receivables = pgTable(
	"receivables",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		debtorName: text("debtor_name").notNull(),
		currency: text("currency").notNull(),
		originalAmountMinor: money("original_amount_minor"),
		currentBalanceMinor: money("current_balance_minor").default(0).notNull(),
		balanceAsOf: date("balance_as_of"),
		interestRateBps: integer("interest_rate_bps"),
		monthlyPaymentMinor: money("monthly_payment_minor"),
		startDate: date("start_date"),
		dueDate: date("due_date"),
		section: text("section"),
		notes: text("notes"),
		isActive: boolean("is_active").default(true).notNull(),
		settledAt: date("settled_at"),
		...timestamps,
	},
	(t) => [index("receivables_user_idx").on(t.userId, t.isActive)],
);

export const receivableBalances = pgTable(
	"receivable_balances",
	{
		id: id(),
		receivableId: text("receivable_id")
			.notNull()
			.references(() => receivables.id, { onDelete: "cascade" }),
		date: date("date").notNull(),
		balanceMinor: money("balance_minor").notNull(),
		source: text("source").default("manual").notNull(),
		createdAt: timestamps.createdAt,
	},
	(t) => [
		uniqueIndex("receivable_balances_receivable_date").on(
			t.receivableId,
			t.date,
		),
	],
);

// Unused since 0.59.0; dropped in a follow-up after the owner confirms.
export const securities = pgTable(
	"securities",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		isin: text("isin"),
		ticker: text("ticker"),
		type: securityTypeEnum("type").default("etf").notNull(),
		assetClass: investmentAssetClassEnum("asset_class")
			.default("other")
			.notNull(),
		currency: text("currency").notNull(),
		// Ongoing product cost such as TER, in basis points per year.
		annualCostBps: integer("annual_cost_bps"),
		broadlyDiversified: boolean("broadly_diversified").default(false).notNull(),
		// Optional product risk indicator, 1 (low) to 7 (high).
		riskClass: integer("risk_class"),
		// Provider hint for market data (e.g. "yahoo:VWCE.DE"); null = manual only.
		...timestamps,
	},
	(t) => [
		uniqueIndex("securities_user_isin")
			.on(t.userId, t.isin)
			.where(sql`${t.isin} is not null`),
	],
);

// Unused since 0.59.0; dropped in a follow-up after the owner confirms.
export const investmentPolicies = pgTable("investment_policies", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	goalName: text("goal_name"),
	targetAmountMinor: money("target_amount_minor"),
	targetDate: date("target_date"),
	monthlyContributionMinor: money("monthly_contribution_minor")
		.default(0)
		.notNull(),
	emergencyReserveMonths: integer("emergency_reserve_months")
		.default(3)
		.notNull(),
	maxDrawdownBps: integer("max_drawdown_bps").default(0).notNull(),
	targetEquityBps: integer("target_equity_bps").default(7000).notNull(),
	targetBondBps: integer("target_bond_bps").default(2000).notNull(),
	targetCashBps: integer("target_cash_bps").default(1000).notNull(),
	targetOtherBps: integer("target_other_bps").default(0).notNull(),
	rebalanceBandBps: integer("rebalance_band_bps").default(500).notNull(),
	maxSinglePositionBps: integer("max_single_position_bps")
		.default(2000)
		.notNull(),
	maxProductCostBps: integer("max_product_cost_bps").default(50).notNull(),
	maxDebtRateBps: integer("max_debt_rate_bps").default(600).notNull(),
	minimumBroadMarketBps: integer("minimum_broad_market_bps")
		.default(8000)
		.notNull(),
	reviewIntervalMonths: integer("review_interval_months").default(12).notNull(),
	lastReviewedAt: date("last_reviewed_at"),
	notes: text("notes"),
	...timestamps,
});

/**
 * What a broker holding is, as far as the plan needs it: its ongoing product
 * cost and whether it is a broadly diversified fund. The broker reports the
 * instrument, never these, so they are recorded per ISIN. Manual `securities`
 * keep their own columns. `source` is "owner" once the owner confirmed or
 * typed the value; facts derivable from the instrument type (a single share
 * costs nothing to hold and is not diversified) are derived at read time.
 */
// Unused since 0.59.0; dropped in a follow-up after the owner confirms.
export const instrumentProfiles = pgTable(
	"instrument_profiles",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		isin: text("isin").notNull(),
		annualCostBps: integer("annual_cost_bps"),
		broadlyDiversified: boolean("broadly_diversified"),
		source: text("source")
			.$type<"derived" | "owner">()
			.default("owner")
			.notNull(),
		...timestamps,
	},
	(t) => [uniqueIndex("instrument_profiles_user_isin").on(t.userId, t.isin)],
);

/**
 * An investment decision the owner approved: the orders as a ticket they place
 * at the broker themselves, or the explicit choice to leave things as they
 * are. Fortuna never sends an order; `orders[].status` is the owner's own
 * record of having placed it.
 */
// Unused since 0.59.0; dropped in a follow-up after the owner confirms.
export const investmentDecisions = pgTable(
	"investment_decisions",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		mode: text("mode").$type<"deposit" | "audit">().notNull(),
		verdict: text("verdict").$type<"act" | "hold" | "leave">().notNull(),
		headline: text("headline").notNull(),
		/** Hr. Koerner's last message, bounded and stripped by the parser. */
		note: text("note"),
		currency: text("currency").notNull(),
		brokerCashMinor: money("broker_cash_minor").notNull(),
		orders: jsonb("orders")
			.$type<
				{
					key: string;
					side: "buy" | "sell";
					isin: string | null;
					name: string;
					amountMinor: number;
					approxQuantity: number | null;
					status: "open" | "placed" | "skipped";
				}[]
			>()
			.notNull(),
		...timestamps,
	},
	(t) => [index("investment_decisions_user").on(t.userId, t.createdAt)],
);

/**
 * Every order Fortuna previewed or placed at Scalable, the owner's decision
 * of 26.09.2026. A row exists from the preview on, so a submission can always
 * be traced to the preview the owner saw and confirmed. The preview and the
 * CLI's answer are encrypted: they are the broker's records, not Fortuna's.
 */
export const brokerOrders = pgTable(
	"broker_orders",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** The approved ticket this order carries out, when there is one. */
		// Not written since 0.59.0: an order is placed from the "Anlegen"
		// proposal directly, without an approved decision ticket.
		decisionId: text("decision_id").references(() => investmentDecisions.id, {
			onDelete: "set null",
		}),
		orderKey: text("order_key"),
		side: text("side").$type<"buy" | "sell">().notNull(),
		isin: text("isin").notNull(),
		instrumentName: text("instrument_name").notNull(),
		amountMinor: money("amount_minor"),
		shares: numeric("shares", { precision: 20, scale: 8, mode: "number" }),
		currency: text("currency").notNull(),
		status: text("status")
			.$type<"previewed" | "submitting" | "submitted" | "failed" | "expired">()
			.notNull(),
		requiresAcknowledgement: boolean("requires_acknowledgement")
			.default(false)
			.notNull(),
		acknowledged: boolean("acknowledged").default(false).notNull(),
		encryptedPreview: text("encrypted_preview"),
		encryptedResult: text("encrypted_result"),
		/**
		 * For a sale, the owner's own "Warum jetzt?" sentence, required before
		 * the preview. Their words, not broker data, so it is kept in plain
		 * text; it is never logged.
		 */
		sellReason: text("sell_reason"),
		/** A safe code only, never provider text. */
		errorCode: text("error_code"),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
		confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
		submittedAt: timestamp("submitted_at", { withTimezone: true }),
		...timestamps,
	},
	(t) => [index("broker_orders_user").on(t.userId, t.createdAt)],
);

// Unused since 0.59.0; dropped in a follow-up after the owner confirms.
export const securityPrices = pgTable(
	"security_prices",
	{
		id: id(),
		securityId: text("security_id")
			.notNull()
			.references(() => securities.id, { onDelete: "cascade" }),
		date: date("date").notNull(),
		price: numeric("price", {
			precision: 20,
			scale: 8,
			mode: "number",
		}).notNull(),
		currency: text("currency").notNull(),
		source: priceSourceEnum("source").default("manual").notNull(),
		createdAt: timestamps.createdAt,
	},
	(t) => [
		uniqueIndex("security_prices_security_date").on(t.securityId, t.date),
	],
);

// Unused since 0.59.0; dropped in a follow-up after the owner confirms.
export const investmentPositions = pgTable(
	"investment_positions",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accountId: text("account_id").references(() => accounts.id, {
			onDelete: "set null",
		}),
		securityId: text("security_id")
			.notNull()
			.references(() => securities.id, { onDelete: "cascade" }),
		quantity: numeric("quantity", {
			precision: 20,
			scale: 8,
			mode: "number",
		}).notNull(),
		// Total cost basis in the security's currency, minor units.
		costBasisMinor: money("cost_basis_minor").notNull(),
		acquiredAt: date("acquired_at"),
		notes: text("notes"),
		...timestamps,
	},
	(t) => [index("positions_user_idx").on(t.userId)],
);

// Provider-neutral investment intake. Monetary provider snapshots contribute
// to net worth regardless of whether the valuation is live or estimated.
export const investmentSourceAccounts = pgTable(
	"investment_source_accounts",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		provider: text("provider").notNull(),
		sourceAccountId: text("source_account_id").notNull(),
		status: connectionStatusEnum("status").default("pending").notNull(),
		method: text("method").default("csv").notNull(),
		linkedAccountId: text("linked_account_id").references(() => accounts.id, {
			onDelete: "set null",
		}),
		currency: text("currency").notNull(),
		cashBalanceMinor: money("cash_balance_minor"),
		cashValuationAt: timestamp("cash_valuation_at", { withTimezone: true }),
		portfolioValueMinor: money("portfolio_value_minor"),
		cryptoValueMinor: money("crypto_value_minor"),
		portfolioValuationAt: timestamp("portfolio_valuation_at", {
			withTimezone: true,
		}),
		lastAttemptedSyncAt: timestamp("last_attempted_sync_at", {
			withTimezone: true,
		}),
		lastSuccessfulSyncAt: timestamp("last_successful_sync_at", {
			withTimezone: true,
		}),
		lastError: text("last_error"),
		capabilities: jsonb("capabilities").$type<string[]>(),
		encryptedRawMetadata: text("encrypted_raw_metadata"),
		...timestamps,
	},
	(t) => [
		uniqueIndex("investment_source_account_unique").on(
			t.userId,
			t.provider,
			t.sourceAccountId,
		),
	],
);

export const investmentSourceTransactions = pgTable(
	"investment_source_transactions",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accountId: text("account_id")
			.notNull()
			.references(() => investmentSourceAccounts.id, { onDelete: "cascade" }),
		sourceId: text("source_id").notNull(),
		sourceFingerprint: text("source_fingerprint").notNull(),
		occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
		kind: text("kind").notNull(),
		status: text("status").notNull(),
		instrumentName: text("instrument_name"),
		isin: text("isin"),
		quantity: numeric("quantity", { precision: 20, scale: 8, mode: "number" }),
		unitPrice: numeric("unit_price", {
			precision: 20,
			scale: 8,
			mode: "number",
		}),
		amountMinor: money("amount_minor").notNull(),
		feeMinor: money("fee_minor"),
		taxMinor: money("tax_minor"),
		currency: text("currency").notNull(),
		// Original CSV fields are encrypted, never returned through oRPC or MCP.
		encryptedRawMetadata: text("encrypted_raw_metadata").notNull(),
		...timestamps,
	},
	(t) => [
		uniqueIndex("investment_source_tx_unique").on(t.accountId, t.sourceId),
		index("investment_source_tx_user_date").on(t.userId, t.occurredAt),
	],
);

/** Encrypted previous versions of a provider transaction before a same-ID correction. */
export const investmentSourceTransactionRevisions = pgTable(
	"investment_source_transaction_revisions",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		transactionId: text("transaction_id")
			.notNull()
			.references(() => investmentSourceTransactions.id, {
				onDelete: "cascade",
			}),
		previousFingerprint: text("previous_fingerprint").notNull(),
		previousOccurredAt: timestamp("previous_occurred_at", {
			withTimezone: true,
		}).notNull(),
		previousStatus: text("previous_status").notNull(),
		previousAmountMinor: money("previous_amount_minor").notNull(),
		encryptedRawMetadata: text("encrypted_raw_metadata").notNull(),
		revisedAt: timestamp("revised_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(t) => [
		index("investment_source_transaction_revisions_tx_idx").on(
			t.transactionId,
			t.revisedAt,
		),
	],
);

export const investmentSourcePositions = pgTable(
	"investment_source_positions",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accountId: text("account_id")
			.notNull()
			.references(() => investmentSourceAccounts.id, { onDelete: "cascade" }),
		instrumentName: text("instrument_name").notNull(),
		isin: text("isin").notNull(),
		externalId: text("external_id"),
		wkn: text("wkn"),
		ticker: text("ticker"),
		assetClass: text("asset_class"),
		quantity: numeric("quantity", {
			precision: 20,
			scale: 8,
			mode: "number",
		}).notNull(),
		costBasisMinor: money("cost_basis_minor"),
		valueMinor: money("value_minor"),
		price: numeric("price", { precision: 20, scale: 8, mode: "number" }),
		currency: text("currency").notNull(),
		valuationAt: timestamp("valuation_at", { withTimezone: true }),
		valuationSource: text("valuation_source"),
		verification: text("verification").default("inferred").notNull(),
		encryptedRawMetadata: text("encrypted_raw_metadata"),
		...timestamps,
	},
	(t) => [
		uniqueIndex("investment_source_position_unique").on(t.accountId, t.isin),
	],
);

/** Indicative daily market observations, never part of booked net-worth history. */
// Unused since 0.59.0; dropped in a follow-up after the owner confirms.
export const scalableMarketCloses = pgTable(
	"scalable_market_closes",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		date: date("date").notNull(),
		currency: text("currency").notNull(),
		confirmedNetWorthMinor: money("confirmed_net_worth_minor").notNull(),
		indicativeNetWorthMinor: money("indicative_net_worth_minor").notNull(),
		marketDeltaMinor: money("market_delta_minor").notNull(),
		quotedAt: timestamp("quoted_at", { withTimezone: true }).notNull(),
		observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
		...timestamps,
	},
	(t) => [uniqueIndex("scalable_market_close_user_date").on(t.userId, t.date)],
);

// Unused since 0.59.0; dropped in a follow-up after the owner confirms.
export const investmentSyncRuns = pgTable(
	"investment_sync_runs",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accountId: text("account_id")
			.notNull()
			.references(() => investmentSourceAccounts.id, { onDelete: "cascade" }),
		mode: text("mode").notNull(),
		status: importStatusEnum("status").notNull(),
		imported: integer("imported").default(0).notNull(),
		duplicates: integer("duplicates").default(0).notNull(),
		observedAt: timestamp("observed_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		errorCode: text("error_code"),
	},
	(t) => [
		index("investment_sync_runs_account_idx").on(t.accountId, t.observedAt),
	],
);

export const fxRates = pgTable(
	"fx_rates",
	{
		id: id(),
		date: date("date").notNull(),
		base: text("base").notNull(),
		quote: text("quote").notNull(),
		// 1 base = rate quote
		rate: numeric("rate", {
			precision: 20,
			scale: 10,
			mode: "number",
		}).notNull(),
		source: text("source").default("manual").notNull(),
		createdAt: timestamps.createdAt,
	},
	(t) => [uniqueIndex("fx_rates_pair_date").on(t.base, t.quote, t.date)],
);

// Relations (used by the relational query API where convenient)
export const accountsRelations = relations(accounts, ({ many, one }) => ({
	balances: many(accountBalances),
	transactions: many(transactions),
	connection: one(bankConnections, {
		fields: [accounts.bankConnectionId],
		references: [bankConnections.id],
	}),
}));
export const accountBalancesRelations = relations(
	accountBalances,
	({ one }) => ({
		account: one(accounts, {
			fields: [accountBalances.accountId],
			references: [accounts.id],
		}),
	}),
);
export const categoriesRelations = relations(categories, ({ one, many }) => ({
	parent: one(categories, {
		fields: [categories.parentId],
		references: [categories.id],
		relationName: "category_parent",
	}),
	children: many(categories, { relationName: "category_parent" }),
}));
export const transactionsRelations = relations(transactions, ({ one }) => ({
	account: one(accounts, {
		fields: [transactions.accountId],
		references: [accounts.id],
	}),
	category: one(categories, {
		fields: [transactions.categoryId],
		references: [categories.id],
	}),
	merchant: one(merchants, {
		fields: [transactions.merchantId],
		references: [merchants.id],
	}),
	recurringPayment: one(recurringPayments, {
		fields: [transactions.recurringPaymentId],
		references: [recurringPayments.id],
	}),
}));
export const assetsRelations = relations(assets, ({ many }) => ({
	valuations: many(assetValuations),
}));
export const assetValuationsRelations = relations(
	assetValuations,
	({ one }) => ({
		asset: one(assets, {
			fields: [assetValuations.assetId],
			references: [assets.id],
		}),
	}),
);
export const liabilitiesRelations = relations(liabilities, ({ many, one }) => ({
	balances: many(liabilityBalances),
	linkedAsset: one(assets, {
		fields: [liabilities.linkedAssetId],
		references: [assets.id],
	}),
}));
export const liabilityBalancesRelations = relations(
	liabilityBalances,
	({ one }) => ({
		liability: one(liabilities, {
			fields: [liabilityBalances.liabilityId],
			references: [liabilities.id],
		}),
	}),
);
export const receivablesRelations = relations(receivables, ({ many }) => ({
	balances: many(receivableBalances),
}));
export const receivableBalancesRelations = relations(
	receivableBalances,
	({ one }) => ({
		receivable: one(receivables, {
			fields: [receivableBalances.receivableId],
			references: [receivables.id],
		}),
	}),
);
export const contractsRelations = relations(contracts, ({ many, one }) => ({
	documents: many(contractDocuments),
	account: one(accounts, {
		fields: [contracts.accountId],
		references: [accounts.id],
	}),
	recurringPayment: one(recurringPayments, {
		fields: [contracts.recurringPaymentId],
		references: [recurringPayments.id],
	}),
}));
export const contractDocumentsRelations = relations(
	contractDocuments,
	({ one }) => ({
		contract: one(contracts, {
			fields: [contractDocuments.contractId],
			references: [contracts.id],
		}),
	}),
);
export const scenariosRelations = relations(scenarios, ({ many }) => ({
	rules: many(scenarioRules),
}));
export const scenarioRulesRelations = relations(scenarioRules, ({ one }) => ({
	scenario: one(scenarios, {
		fields: [scenarioRules.scenarioId],
		references: [scenarios.id],
	}),
}));
export const copilotMemoriesRelations = relations(
	copilotMemories,
	({ one }) => ({
		owner: one(user, {
			fields: [copilotMemories.userId],
			references: [user.id],
		}),
	}),
);
export const securitiesRelations = relations(securities, ({ many }) => ({
	prices: many(securityPrices),
	positions: many(investmentPositions),
}));
export const securityPricesRelations = relations(securityPrices, ({ one }) => ({
	security: one(securities, {
		fields: [securityPrices.securityId],
		references: [securities.id],
	}),
}));
export const investmentPositionsRelations = relations(
	investmentPositions,
	({ one }) => ({
		security: one(securities, {
			fields: [investmentPositions.securityId],
			references: [securities.id],
		}),
		account: one(accounts, {
			fields: [investmentPositions.accountId],
			references: [accounts.id],
		}),
	}),
);

export type Account = typeof accounts.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type CategorizationRule = typeof categorizationRules.$inferSelect;
export type RecurringPayment = typeof recurringPayments.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type AssetValuation = typeof assetValuations.$inferSelect;
export type Liability = typeof liabilities.$inferSelect;
export type Receivable = typeof receivables.$inferSelect;
export type ReceivableBalance = typeof receivableBalances.$inferSelect;
export type Security = typeof securities.$inferSelect;
export type InvestmentPolicy = typeof investmentPolicies.$inferSelect;
export type BrokerOrder = typeof brokerOrders.$inferSelect;
export type InvestmentPosition = typeof investmentPositions.$inferSelect;
export type ImportJob = typeof importJobs.$inferSelect;
export type BankConnection = typeof bankConnections.$inferSelect;
export type ProviderCredential = typeof providerCredentials.$inferSelect;
export type ExternalConnection = typeof externalConnections.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
export type Optimization = typeof optimizations.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type ContractDocument = typeof contractDocuments.$inferSelect;
export type Scenario = typeof scenarios.$inferSelect;
export type ScenarioRule = typeof scenarioRules.$inferSelect;
export type CopilotMemory = typeof copilotMemories.$inferSelect;
export type CopilotThread = typeof copilotThreads.$inferSelect;
export type AccountProjection = typeof accountProjections.$inferSelect;
