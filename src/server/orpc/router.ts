import { ORPCError } from "@orpc/server";
import * as v from "valibot";
import { GROWTH_PERIODS } from "@/domain/progress";
import {
	AccountInput,
	AccountUpdate,
	AssetInput,
	AssetUpdate,
	BalanceInput,
	BrokerOrderId,
	BrokerOrderPreview,
	BrokerOrderSubmit,
	CashMovementInput,
	CategoryConsult,
	CategoryInput,
	CategoryReviewApply,
	CategoryUpdate,
	ContractDocumentInput,
	ContractInput,
	ContractUpdate,
	CsvCommitInput,
	CsvPreviewInput,
	DeskUnfile,
	FinancialObservationUpdate,
	FinancialProfileUpdate,
	ForecastInput,
	FxRateInput,
	IdInput,
	id,
	isoDate,
	LiabilityBalanceInput,
	LiabilityInput,
	LiabilityUpdate,
	McpTokenInput,
	OptimizationInput,
	OptimizationUpdate,
	PeriodInput,
	RecapInput,
	RecapMonth,
	ReceivableBalanceInput,
	ReceivableInput,
	ReceivableUpdate,
	RecurringInput,
	RecurringUpdate,
	RuleInput,
	RuleUpdate,
	SearchInput,
	SettingsUpdate,
	TransactionFilter,
	TransactionInput,
	TransactionUpdate,
	TransferLink,
	ValuationInput,
} from "@/lib/schemas";
import {
	EnableBankingApiError,
	testEnableBankingAccess,
} from "@/server/providers/bank/enable-banking-client";
import { psuPresenceFromHeaders } from "@/server/providers/bank/psu-presence";
import * as accountsSvc from "@/server/services/accounts";
import * as assetsSvc from "@/server/services/assets";
import * as brokerOrdersSvc from "@/server/services/broker-orders";
import * as cashSvc from "@/server/services/cash";
import * as cashflowSvc from "@/server/services/cashflow";
import * as categoriesSvc from "@/server/services/categories";
import * as categorisationSvc from "@/server/services/categorisation";
import * as connectionsSvc from "@/server/services/connections";
import * as contractsSvc from "@/server/services/contracts";
import * as copilotSvc from "@/server/services/copilot";
import * as copilotMemorySvc from "@/server/services/copilot-memory";
import { dashboard } from "@/server/services/dashboard";
import * as deskSvc from "@/server/services/desk";
import * as enableBankingSvc from "@/server/services/enable-banking";
import * as forecastSvc from "@/server/services/forecast";
import * as hrKoernerSvc from "@/server/services/hr-koerner";
import * as importSvc from "@/server/services/import";
import * as insightsSvc from "@/server/services/insights";
import * as investmentAdviceSvc from "@/server/services/investment-advice";
import * as investmentSourcesSvc from "@/server/services/investment-sources";
import * as katasterSvc from "@/server/services/kataster";
import * as liabilitiesSvc from "@/server/services/liabilities";
import * as mcpTokenSvc from "@/server/services/mcp-tokens";
import * as monthlyRecapSvc from "@/server/services/monthly-recap";
import * as netWorthSvc from "@/server/services/net-worth";
import * as optimizationsSvc from "@/server/services/optimizations";
import * as progressSvc from "@/server/services/progress";
import * as providerCredentialsSvc from "@/server/services/provider-credentials";
import * as receivablesSvc from "@/server/services/receivables";
import * as recurringSvc from "@/server/services/recurring";
import * as remiseSvc from "@/server/services/remise";
import * as rulesSvc from "@/server/services/rules";
import * as scalableHostedSvc from "@/server/services/scalable-hosted";
import { globalSearch } from "@/server/services/search";
import * as settingsSvc from "@/server/services/settings";
import * as txSvc from "@/server/services/transactions";
import { authed, mutation, sessionRead } from "./base";

const Months = v.object({
	months: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(120)),
	),
});

export const router = {
	hrKoerner: {
		profile: authed.handler(({ context }) =>
			hrKoernerSvc.getFinancialProfile(context.user.id),
		),
		// The owner's own rules: session-only, never the Copilot's or MCP's.
		investmentRules: sessionRead.handler(({ context }) =>
			hrKoernerSvc.getInvestmentRules(context.user.id),
		),
		updateProfile: mutation
			.input(FinancialProfileUpdate)
			.handler(({ context, input }) =>
				hrKoernerSvc.updateFinancialProfile(context.user.id, input),
			),
		observations: authed.handler(({ context }) =>
			hrKoernerSvc.listObservations(context.user.id),
		),
		updateObservation: mutation
			.input(FinancialObservationUpdate)
			.handler(({ context, input }) =>
				hrKoernerSvc.updateObservation(context.user.id, input),
			),
		reviewDue: mutation.handler(({ context }) =>
			hrKoernerSvc.reviewDue(context.user.id),
		),
		reviewNow: mutation.handler(({ context }) =>
			hrKoernerSvc.reviewDue(context.user.id, true),
		),
		reviewHealth: authed.handler(({ context }) =>
			hrKoernerSvc.reviewHealth(context.user.id),
		),
		weeklyReport: authed.handler(({ context }) =>
			hrKoernerSvc.weeklyReport(context.user.id),
		),
	},
	dashboard: authed.handler(({ context }) => dashboard(context.user.id)),
	search: authed
		.input(SearchInput)
		.handler(({ context, input }) =>
			globalSearch(context.user.id, input.q, input.limit),
		),

	settings: {
		get: authed.handler(({ context }) =>
			settingsSvc.getSettings(context.user.id),
		),
		update: mutation
			.input(SettingsUpdate)
			.handler(({ context, input }) =>
				settingsSvc.updateSettings(context.user.id, input),
			),
		fxRates: authed.handler(() => settingsSvc.listFxRates()),
		upsertFxRate: mutation
			.input(FxRateInput)
			.handler(({ input }) => settingsSvc.upsertFxRate(input)),
	},

	providerCredentials: {
		enableBankingStatus: authed.handler(({ context }) =>
			providerCredentialsSvc.getEnableBankingCredentialStatus(context.user.id),
		),
		deleteEnableBanking: mutation.handler(({ context }) =>
			providerCredentialsSvc.deleteEnableBankingCredential(context.user.id),
		),
		testEnableBanking: mutation.handler(async ({ context }) => {
			const credential =
				await providerCredentialsSvc.loadEnableBankingCredential(
					context.user.id,
				);
			if (!credential) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Enable Banking ist nicht eingerichtet",
				});
			}
			try {
				return await testEnableBankingAccess(credential);
			} catch (error) {
				if (error instanceof EnableBankingApiError) {
					throw new ORPCError("BAD_GATEWAY", {
						message: `Enable-Banking-Test fehlgeschlagen (${error.status}): ${error.message}`,
					});
				}
				throw error;
			}
		}),
		enableBankingInstitutions: authed.handler(({ context }) =>
			enableBankingSvc.listEnableBankingInstitutions(context.user.id),
		),
		beginEnableBankingConnection: mutation
			.input(
				v.object({
					institutionName: v.pipe(v.string(), v.minLength(1)),
					institutionCountry: v.pipe(
						v.string(),
						v.regex(/^[A-Z]{2}$/, "Ungültiges Land"),
					),
				}),
			)
			.handler(({ context, input }) =>
				enableBankingSvc.beginEnableBankingConnection(
					context.user.id,
					input.institutionName,
					input.institutionCountry,
				),
			),
	},

	remise: {
		status: authed.handler(({ context }) =>
			remiseSvc.getRemiseConnectionStatus(context.user.id),
		),
		connect: mutation.handler(({ context }) =>
			remiseSvc.beginRemiseConnection(context.user.id),
		),
		sync: mutation.handler(({ context }) =>
			remiseSvc.syncRemiseConnection(context.user.id),
		),
		disconnect: mutation.handler(({ context }) =>
			remiseSvc.disconnectRemise(context.user.id),
		),
	},

	scalable: {
		marketPulse: sessionRead.handler(({ context }) =>
			scalableHostedSvc.scalableMarketPulse(context.user.id),
		),
		status: authed.handler(({ context }) =>
			scalableHostedSvc.scalableHostedStatus(context.user.id),
		),
		connect: mutation.handler(({ context }) =>
			scalableHostedSvc.beginScalableHostedConnection(context.user.id),
		),
		sync: mutation.handler(({ context }) =>
			scalableHostedSvc.requestScalableHostedSync(context.user.id),
		),
		syncDue: mutation.handler(({ context }) =>
			scalableHostedSvc.syncScalableHostedDue(context.user.id),
		),
		disconnect: mutation.handler(({ context }) =>
			scalableHostedSvc.disconnectScalableHosted(context.user.id),
		),
	},

	kataster: {
		status: authed.handler(({ context }) =>
			katasterSvc.getKatasterStatus(context.user.id),
		),
		summary: authed.handler(({ context }) =>
			katasterSvc.getKatasterSummary(context.user.id),
		),
		disconnect: mutation.handler(({ context }) =>
			katasterSvc.disconnectKataster(context.user.id),
		),
	},

	copilot: {
		status: authed.handler(({ context }) =>
			copilotSvc.getCopilotStatus(context.user.id),
		),
		startLogin: mutation.handler(({ context }) =>
			copilotSvc.startCopilotLogin(context.user.id),
		),
		disconnect: mutation.handler(({ context }) =>
			copilotSvc.disconnectCopilot(context.user.id),
		),
		resetChat: mutation.handler(({ context }) =>
			copilotSvc.resetCopilotChat(context.user.id),
		),
		memories: authed.handler(({ context }) =>
			copilotMemorySvc.listMemories(context.user.id),
		),
		forgetMemory: mutation
			.input(IdInput)
			.handler(({ context, input }) =>
				copilotMemorySvc.forget(context.user.id, input.id),
			),
	},

	contracts: {
		list: authed.handler(({ context }) =>
			contractsSvc.listContracts(context.user.id),
		),
		create: mutation
			.input(ContractInput)
			.handler(({ context, input }) =>
				contractsSvc.createContract(context.user.id, input),
			),
		update: mutation
			.input(ContractUpdate)
			.handler(({ context, input }) =>
				contractsSvc.updateContract(context.user.id, input),
			),
		remove: mutation
			.input(IdInput)
			.handler(({ context, input }) =>
				contractsSvc.deleteContract(context.user.id, input.id),
			),
		attachDocument: mutation
			.input(ContractDocumentInput)
			.handler(({ context, input }) =>
				contractsSvc.attachContractDocument(context.user.id, input),
			),
	},

	insights: {
		recap: authed
			.input(RecapInput)
			.handler(({ context, input }) =>
				insightsSvc.recapReport(context.user.id, input),
			),
		quality: authed.handler(({ context }) =>
			insightsSvc.dataQuality(context.user.id),
		),
	},

	accounts: {
		list: authed
			.input(v.optional(v.object({ includeInactive: v.optional(v.boolean()) })))
			.handler(({ context, input }) =>
				accountsSvc.listAccounts(context.user.id, input ?? {}),
			),
		get: authed
			.input(IdInput)
			.handler(({ context, input }) =>
				accountsSvc.getAccount(context.user.id, input.id),
			),
		create: mutation
			.input(AccountInput)
			.handler(({ context, input }) =>
				accountsSvc.createAccount(context.user.id, input),
			),
		update: mutation
			.input(AccountUpdate)
			.handler(({ context, input }) =>
				accountsSvc.updateAccount(context.user.id, input),
			),
		recordBalance: mutation
			.input(BalanceInput)
			.handler(({ context, input }) =>
				accountsSvc.recordBalance(context.user.id, input),
			),
		balanceHistory: authed
			.input(v.object({ id, ...Months.entries }))
			.handler(({ context, input }) =>
				accountsSvc.balanceHistory(
					context.user.id,
					input.id,
					input.months ?? 12,
				),
			),
	},

	paypalFunding: {
		link: mutation.handler(({ context }) =>
			enableBankingSvc.linkPaypalFunding(context.user.id),
		),
	},

	categories: {
		list: authed.handler(({ context }) =>
			categoriesSvc.listCategories(context.user.id),
		),
		create: mutation
			.input(CategoryInput)
			.handler(({ context, input }) =>
				categoriesSvc.createCategory(context.user.id, input),
			),
		update: mutation
			.input(CategoryUpdate)
			.handler(({ context, input }) =>
				categoriesSvc.updateCategory(context.user.id, input),
			),
		delete: mutation
			.input(IdInput)
			.handler(({ context, input }) =>
				categoriesSvc.deleteCategory(context.user.id, input.id),
			),
	},

	rules: {
		list: authed.handler(({ context }) => rulesSvc.listRules(context.user.id)),
		create: mutation
			.input(RuleInput)
			.handler(({ context, input }) =>
				rulesSvc.createRule(context.user.id, input),
			),
		update: mutation
			.input(RuleUpdate)
			.handler(({ context, input }) =>
				rulesSvc.updateRule(context.user.id, input),
			),
		delete: mutation
			.input(IdInput)
			.handler(({ context, input }) =>
				rulesSvc.deleteRule(context.user.id, input.id),
			),
	},

	// The batch review of uncategorised bookings. Reading is a plain query;
	// writing is session-only like every other mutation, so the read-only MCP
	// surface can look but never categorise.
	mcpTokens: {
		list: sessionRead.handler(({ context }) =>
			mcpTokenSvc.listMcpTokens(context.user.id),
		),
		create: mutation
			.input(McpTokenInput)
			.handler(async ({ context, input }) => {
				const created = await mcpTokenSvc.createMcpToken(
					context.user.id,
					input,
				);
				// The snippet is built here so the plain token never has to be
				// returned twice or held anywhere to be shown again.
				return {
					...created,
					snippet: mcpTokenSvc.mcpSetupSnippet({
						baseUrl: process.env.BETTER_AUTH_URL ?? "",
						token: created.token,
						scope: input.scope,
					}),
				};
			}),
		revoke: mutation
			.input(IdInput)
			.handler(({ context, input }) =>
				mcpTokenSvc.revokeMcpToken(context.user.id, input),
			),
	},

	// Hr. Körner's desk at "/". Session-only throughout: it is the owner's own
	// screen, and filing or unfiling bookings is not an MCP write tool.
	desk: {
		today: sessionRead.handler(({ context }) =>
			deskSvc.deskToday(context.user.id),
		),
		fileCertain: mutation.handler(({ context }) =>
			deskSvc.fileCertain(context.user.id),
		),
		unfile: mutation
			.input(DeskUnfile)
			.handler(({ context, input }) =>
				deskSvc.unfile(context.user.id, input.transactionIds),
			),
		// The month recap: on the desk in a month's first days until read,
		// and any past full month on request.
		recap: sessionRead.handler(({ context }) =>
			monthlyRecapSvc.deskRecap(context.user.id),
		),
		recapFor: sessionRead
			.input(RecapMonth)
			.handler(({ context, input }) =>
				monthlyRecapSvc.monthlyRecap(context.user.id, input.month),
			),
		recapRead: mutation
			.input(RecapMonth)
			.handler(({ context, input }) =>
				monthlyRecapSvc.markRecapRead(context.user.id, input.month),
			),
	},

	categorisation: {
		review: authed.handler(({ context }) =>
			categorisationSvc.categoryReview(context.user.id),
		),
		apply: mutation
			.input(CategoryReviewApply)
			.handler(({ context, input }) =>
				categorisationSvc.applyCategoryReview(context.user.id, input),
			),
		// A `mutation` although it writes nothing: it spends a model call on the
		// owner's account, so the read-only MCP token must not be able to run it.
		consult: mutation
			.input(CategoryConsult)
			.handler(({ context, input }) =>
				categorisationSvc.consultCategorisation(context.user.id, input),
			),
	},

	transactions: {
		list: authed
			.input(TransactionFilter)
			.handler(({ context, input }) =>
				txSvc.listTransactions(context.user.id, input),
			),
		get: authed
			.input(IdInput)
			.handler(({ context, input }) =>
				txSvc.getTransaction(context.user.id, input.id),
			),
		create: mutation
			.input(TransactionInput)
			.handler(({ context, input }) =>
				txSvc.createTransaction(context.user.id, input),
			),
		update: mutation
			.input(TransactionUpdate)
			.handler(({ context, input }) =>
				txSvc.updateTransaction(context.user.id, input),
			),
		delete: mutation
			.input(IdInput)
			.handler(({ context, input }) =>
				txSvc.deleteTransaction(context.user.id, input.id),
			),
		linkTransfer: mutation
			.input(TransferLink)
			.handler(({ context, input }) =>
				txSvc.linkTransfer(context.user.id, input.outflowId, input.inflowId),
			),
		unlinkTransfer: mutation
			.input(IdInput)
			.handler(({ context, input }) =>
				txSvc.unlinkTransfer(context.user.id, input.id),
			),
		detectTransfers: mutation.handler(({ context }) =>
			txSvc.detectAndLinkTransfers(context.user.id),
		),
	},

	imports: {
		preview: mutation
			.input(CsvPreviewInput)
			.handler(({ context, input }) =>
				importSvc.previewCsv(context.user.id, input),
			),
		commit: mutation
			.input(CsvCommitInput)
			.handler(async ({ context, input }) => {
				const job = await importSvc.commitCsv(context.user.id, input);
				if (job.importedRows > 0)
					await recurringSvc.detectRecurringAfterImport(context.user.id);
				return job;
			}),
		list: authed.handler(({ context }) =>
			importSvc.listImportJobs(context.user.id),
		),
	},

	recurring: {
		list: authed
			.input(v.optional(v.object({ includeInactive: v.optional(v.boolean()) })))
			.handler(({ context, input }) =>
				recurringSvc.listRecurring(context.user.id, input ?? {}),
			),
		create: mutation
			.input(RecurringInput)
			.handler(({ context, input }) =>
				recurringSvc.createRecurring(context.user.id, input),
			),
		update: mutation
			.input(RecurringUpdate)
			.handler(({ context, input }) =>
				recurringSvc.updateRecurring(context.user.id, input),
			),
		delete: mutation
			.input(IdInput)
			.handler(({ context, input }) =>
				recurringSvc.deleteRecurring(context.user.id, input.id),
			),
		linkMatches: mutation
			.input(IdInput)
			.handler(({ context, input }) =>
				recurringSvc.linkMatchingBookings(context.user.id, input.id),
			),
		detect: mutation.handler(async ({ context }) => {
			const result = await recurringSvc.runRecurringDetection(context.user.id);
			return {
				created: result.created,
				updated: result.updated,
				candidates: result.candidates.length,
			};
		}),
	},

	cashflow: {
		report: authed
			.input(v.optional(PeriodInput))
			.handler(({ context, input }) =>
				cashflowSvc.cashflowReport(context.user.id, input ?? {}),
			),
		forecast: authed
			.input(v.optional(ForecastInput))
			.handler(({ context, input }) =>
				forecastSvc.cashflowForecast(context.user.id, input ?? {}),
			),
	},

	cash: {
		summary: authed.handler(({ context }) =>
			cashSvc.cashSummary(context.user.id),
		),
		recordMovement: mutation
			.input(CashMovementInput)
			.handler(({ context, input }) =>
				cashSvc.recordCashMovement(context.user.id, input),
			),
	},

	assets: {
		list: authed
			.input(v.optional(v.object({ includeInactive: v.optional(v.boolean()) })))
			.handler(({ context, input }) =>
				assetsSvc.listAssets(context.user.id, input ?? {}),
			),
		get: authed
			.input(IdInput)
			.handler(({ context, input }) =>
				assetsSvc.getAsset(context.user.id, input.id),
			),
		create: mutation
			.input(AssetInput)
			.handler(({ context, input }) =>
				assetsSvc.createAsset(context.user.id, input),
			),
		update: mutation
			.input(AssetUpdate)
			.handler(({ context, input }) =>
				assetsSvc.updateAsset(context.user.id, input),
			),
		delete: mutation
			.input(IdInput)
			.handler(({ context, input }) =>
				assetsSvc.deleteAsset(context.user.id, input.id),
			),
		addValuation: mutation
			.input(ValuationInput)
			.handler(({ context, input }) =>
				assetsSvc.addValuation(context.user.id, input),
			),
		deleteValuation: mutation
			.input(IdInput)
			.handler(({ context, input }) =>
				assetsSvc.deleteValuation(context.user.id, input.id),
			),
	},

	liabilities: {
		list: authed
			.input(v.optional(v.object({ includeInactive: v.optional(v.boolean()) })))
			.handler(({ context, input }) =>
				liabilitiesSvc.listLiabilities(context.user.id, input ?? {}),
			),
		get: authed
			.input(IdInput)
			.handler(({ context, input }) =>
				liabilitiesSvc.getLiability(context.user.id, input.id),
			),
		create: mutation
			.input(LiabilityInput)
			.handler(({ context, input }) =>
				liabilitiesSvc.createLiability(context.user.id, input),
			),
		update: mutation
			.input(LiabilityUpdate)
			.handler(({ context, input }) =>
				liabilitiesSvc.updateLiability(context.user.id, input),
			),
		delete: mutation
			.input(IdInput)
			.handler(({ context, input }) =>
				liabilitiesSvc.deleteLiability(context.user.id, input.id),
			),
		recordBalance: mutation
			.input(LiabilityBalanceInput)
			.handler(({ context, input }) =>
				liabilitiesSvc.recordLiabilityBalance(context.user.id, input),
			),
	},

	receivables: {
		list: authed
			.input(v.optional(v.object({ includeInactive: v.optional(v.boolean()) })))
			.handler(({ context, input }) =>
				receivablesSvc.listReceivables(context.user.id, input ?? {}),
			),
		get: authed
			.input(IdInput)
			.handler(({ context, input }) =>
				receivablesSvc.getReceivable(context.user.id, input.id),
			),
		create: mutation
			.input(ReceivableInput)
			.handler(({ context, input }) =>
				receivablesSvc.createReceivable(context.user.id, input),
			),
		update: mutation
			.input(ReceivableUpdate)
			.handler(({ context, input }) =>
				receivablesSvc.updateReceivable(context.user.id, input),
			),
		delete: mutation
			.input(IdInput)
			.handler(({ context, input }) =>
				receivablesSvc.deleteReceivable(context.user.id, input.id),
			),
		recordBalance: mutation
			.input(ReceivableBalanceInput)
			.handler(({ context, input }) =>
				receivablesSvc.recordReceivableBalance(context.user.id, input),
			),
	},

	optimizations: {
		list: authed.handler(({ context }) =>
			optimizationsSvc.listOptimizations(context.user.id),
		),
		create: mutation
			.input(OptimizationInput)
			.handler(({ context, input }) =>
				optimizationsSvc.createOptimization(context.user.id, input),
			),
		update: mutation
			.input(OptimizationUpdate)
			.handler(({ context, input }) =>
				optimizationsSvc.updateOptimization(context.user.id, input),
			),
		delete: mutation
			.input(IdInput)
			.handler(({ context, input }) =>
				optimizationsSvc.deleteOptimization(context.user.id, input.id),
			),
	},

	// Orders at Scalable: session-only by construction (`mutation`,
	// `sessionRead`), never in COPILOT_TOOLS or MCP_WRITE_TOOL_NAMES.
	brokerOrders: {
		status: sessionRead.handler(({ context }) =>
			brokerOrdersSvc.tradingStatus(context.user.id),
		),
		beginLogin: mutation.handler(({ context }) =>
			brokerOrdersSvc.beginTradingLogin(context.user.id),
		),
		disconnect: mutation.handler(({ context }) =>
			brokerOrdersSvc.disconnectTrading(context.user.id),
		),
		preview: mutation
			.input(BrokerOrderPreview)
			.handler(({ context, input }) =>
				brokerOrdersSvc.previewOrder(context.user.id, input),
			),
		submit: mutation
			.input(BrokerOrderSubmit)
			.handler(({ context, input }) =>
				brokerOrdersSvc.submitOrder(context.user.id, input),
			),
		discard: mutation
			.input(BrokerOrderId)
			.handler(({ context, input }) =>
				brokerOrdersSvc.discardPreview(context.user.id, input.orderId),
			),
		list: sessionRead.handler(({ context }) =>
			brokerOrdersSvc.listOrders(context.user.id),
		),
	},

	// "Anlegen": a deterministic proposal from the target split and the
	// reserve. It reads and writes nothing else, so the MCP may read it too.
	investmentAdvice: {
		plan: authed.handler(({ context }) =>
			investmentAdviceSvc.investmentPlan(context.user.id),
		),
	},

	investments: {
		linkScalableAccount: mutation
			.input(
				v.object({
					sourceAccountId: v.string(),
					linkedAccountId: v.nullable(v.string()),
				}),
			)
			.handler(({ context, input }) =>
				investmentSourcesSvc.linkScalableAccount(
					context.user.id,
					input.sourceAccountId,
					input.linkedAccountId,
				),
			),
		sourceStatus: authed.handler(({ context }) =>
			investmentSourcesSvc.investmentSourceStatus(context.user.id),
		),
		sourceAccounts: authed.handler(({ context }) =>
			investmentSourcesSvc.listInvestmentSourceAccounts(context.user.id),
		),
		sourceAccount: authed
			.input(
				v.object({
					id,
					offset: v.pipe(
						v.number(),
						v.integer(),
						v.minValue(0),
						v.maxValue(100_000),
					),
					limit: v.pipe(
						v.number(),
						v.integer(),
						v.minValue(1),
						v.maxValue(100),
					),
				}),
			)
			.handler(({ context, input }) =>
				investmentSourcesSvc.getInvestmentSourceAccount(
					context.user.id,
					input.id,
					input,
				),
			),
		sourcePositions: authed.handler(({ context }) =>
			investmentSourcesSvc.listInvestmentSourcePositions(context.user.id),
		),
		sourceTransactions: authed
			.input(
				v.optional(
					v.object({
						from: v.optional(isoDate),
						to: v.optional(isoDate),
						direction: v.optional(v.picklist(["inflow", "outflow"])),
						limit: v.optional(
							v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)),
						),
					}),
				),
			)
			.handler(({ context, input }) =>
				investmentSourcesSvc.listInvestmentSourceTransactions(
					context.user.id,
					input,
				),
			),
		sourceTransactionPage: authed
			.input(
				v.object({
					from: v.optional(isoDate),
					to: v.optional(isoDate),
					direction: v.optional(v.picklist(["inflow", "outflow"])),
					limit: v.pipe(
						v.number(),
						v.integer(),
						v.minValue(1),
						v.maxValue(100),
					),
					offset: v.pipe(
						v.number(),
						v.integer(),
						v.minValue(0),
						v.maxValue(100_000),
					),
				}),
			)
			.handler(({ context, input }) =>
				investmentSourcesSvc.listInvestmentSourceTransactionPage(
					context.user.id,
					input,
				),
			),
	},

	netWorth: {
		current: authed.handler(({ context }) =>
			netWorthSvc.currentNetWorth(context.user.id),
		),
		history: authed
			.input(v.optional(Months))
			.handler(({ context, input }) =>
				netWorthSvc.netWorthHistory(context.user.id, input?.months ?? 24),
			),
		at: authed
			.input(v.object({ date: isoDate }))
			.handler(({ context, input }) =>
				netWorthSvc.netWorthAt(context.user.id, input.date),
			),
		/** Where the change came from over a period, and the savings streak. */
		progress: authed
			.input(v.object({ period: v.picklist(GROWTH_PERIODS) }))
			.handler(({ context, input }) =>
				progressSvc.netWorthProgress(context.user.id, input.period),
			),
	},

	connections: {
		list: authed.handler(({ context }) =>
			connectionsSvc.listConnections(context.user.id),
		),
		syncDue: mutation.handler(async ({ context }) => {
			// The owner's own request is what starts this, so the bank is told they
			// are present rather than being asked for a background read.
			const result = await connectionsSvc.syncDueConnections(
				context.user.id,
				new Date(),
				psuPresenceFromHeaders(context.headers),
			);
			if (result.imported > 0)
				await recurringSvc.detectRecurringAfterImport(context.user.id);
			const filed =
				result.imported > 0
					? await deskSvc.fileCertainAfterImport(context.user.id)
					: null;
			return { ...result, filed };
		}),
		sync: mutation.input(IdInput).handler(async ({ context, input }) => {
			const result = await connectionsSvc.syncConnection(
				context.user.id,
				input.id,
				psuPresenceFromHeaders(context.headers),
			);
			if (result.imported > 0)
				await recurringSvc.detectRecurringAfterImport(context.user.id);
			const filed =
				result.imported > 0
					? await deskSvc.fileCertainAfterImport(context.user.id)
					: null;
			return { ...result, filed };
		}),
		disconnect: mutation
			.input(IdInput)
			.handler(({ context, input }) =>
				connectionsSvc.disconnect(context.user.id, input.id),
			),
		remove: mutation
			.input(IdInput)
			.handler(({ context, input }) =>
				connectionsSvc.removeConnection(context.user.id, input.id),
			),
	},
};

export type AppRouter = typeof router;
