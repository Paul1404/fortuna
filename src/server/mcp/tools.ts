import { call } from "@orpc/server";
import { toJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import {
	ForecastInput,
	isoDate,
	PeriodInput,
	RecapInput,
	SearchInput,
	TransactionFilter,
} from "@/lib/schemas";
import { markDataChanged } from "@/server/data-revision";
import type { ORPCContext } from "@/server/orpc/base";
import { router } from "@/server/orpc/router";
import { COPILOT_TOOLS } from "@/server/services/copilot";

// Read-only tools. Each one is a thin wrapper over an oRPC procedure so the
// MCP surface can never diverge from what the app itself computes, and the
// "mcp" principal keeps every mutation out of reach.

export type McpTool = {
	name: string;
	description: string;
	input: v.GenericSchema;
	/** Defaults to read-only; a write tool says so to the client. */
	hints?: {
		readOnlyHint: boolean;
		destructiveHint: boolean;
		idempotentHint: boolean;
	};
	execute: (context: ORPCContext, input: unknown) => Promise<unknown>;
};

const READ_ONLY = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
};
const Empty = v.object({});
const Months = v.object({
	months: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(120)),
	),
});

function tool<S extends v.GenericSchema>(
	name: string,
	description: string,
	input: S,
	execute: (context: ORPCContext, input: v.InferOutput<S>) => Promise<unknown>,
): McpTool {
	return {
		name,
		description,
		input,
		execute: (context, raw) => execute(context, raw as v.InferOutput<S>),
	};
}

export const MCP_TOOLS: McpTool[] = [
	tool(
		"get_accounts",
		"List financial accounts with current balances, type, currency and sync status.",
		Empty,
		(c) => call(router.accounts.list, {}, { context: c }),
	),
	tool(
		"get_account_balances",
		"Balance history for one account over the last N months.",
		v.object({ accountId: v.string(), ...Months.entries }),
		(c, i) =>
			call(
				router.accounts.balanceHistory,
				{ id: i.accountId, months: i.months },
				{ context: c },
			),
	),
	tool(
		"get_transactions",
		"List bank transactions and separate imported investment activity. Investment activity is not bank cashflow.",
		TransactionFilter,
		async (c, i) => ({
			bank: await call(router.transactions.list, i, { context: c }),
			investment:
				i.accountId ||
				i.categoryId ||
				i.merchantId ||
				i.recurringPaymentId ||
				i.q
					? []
					: await call(
							router.investments.sourceTransactions,
							{
								from: i.from,
								to: i.to,
								limit: i.limit,
								direction: i.direction,
							},
							{ context: c },
						),
		}),
	),
	tool(
		"search_transactions",
		"Full-text search over transaction descriptions, merchants and notes.",
		v.object({
			q: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
			limit: v.optional(
				v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)),
				50,
			),
		}),
		(c, i) =>
			call(
				router.transactions.list,
				{ q: i.q, limit: i.limit },
				{ context: c },
			),
	),
	tool(
		"get_categories",
		"List transaction categories (with parent/child structure and usage counts).",
		Empty,
		(c) => call(router.categories.list, undefined, { context: c }),
	),
	tool(
		"get_recurring_payments",
		"Detected and manual recurring payments and subscriptions with next expected dates.",
		Empty,
		(c) => call(router.recurring.list, {}, { context: c }),
	),
	tool(
		"get_cashflow",
		"Monthly income, expenses, net and rolling averages for a period.",
		PeriodInput,
		(c, i) => call(router.cashflow.report, i, { context: c }),
	),
	tool(
		"get_cashflow_forecast",
		"Projected liquid balance over a horizon, separating scheduled, recurring and uncertain components.",
		ForecastInput,
		(c, i) => call(router.cashflow.forecast, i, { context: c }),
	),
	tool(
		"get_assets",
		"Manually tracked assets (real estate, vehicles, collectibles, ...) with current values.",
		Empty,
		(c) => call(router.assets.list, {}, { context: c }),
	),
	tool(
		"get_asset_valuations",
		"Valuation history for one asset.",
		v.object({ assetId: v.string() }),
		(c, i) => call(router.assets.get, { id: i.assetId }, { context: c }),
	),
	tool(
		"get_liabilities",
		"Loans, mortgages and other debts with balances and terms.",
		Empty,
		(c) => call(router.liabilities.list, {}, { context: c }),
	),
	tool(
		"get_receivables",
		"Money other people owe the owner, with current outstanding balances, due dates and terms.",
		Empty,
		(c) => call(router.receivables.list, {}, { context: c }),
	),
	tool(
		"get_investments",
		// The broker depot used to be listed as "unverifiedCsv" with an order not
		// to count it, long after the CSV import was removed: an AI client then
		// left the owner's whole Scalable portfolio out of net worth.
		"Investment positions: `broker` holds the depot synced from the broker, each with its own `verification` (provider_reported values count in net worth).",
		Empty,
		async (c) => ({
			broker: await call(router.investments.sourcePositions, undefined, {
				context: c,
			}),
		}),
	),
	tool(
		"get_investment_process",
		"The owner's target split and reserve, and what Fortuna proposes for free money: bank cash above the reserve to transfer, and buys by the split into instruments already held. A deterministic proposal; it places nothing and lists no placed orders.",
		Empty,
		(c) => call(router.investmentAdvice.plan, undefined, { context: c }),
	),
	tool(
		"get_net_worth",
		"Current net worth breakdown: assets, liabilities, liquidity and allocation.",
		Empty,
		(c) => call(router.netWorth.current, undefined, { context: c }),
	),
	tool(
		"get_net_worth_history",
		"Month-end net worth history for the last N months.",
		Months,
		(c, i) => call(router.netWorth.history, i, { context: c }),
	),
	tool(
		"get_net_worth_at",
		"Net worth breakdown as of a specific date.",
		v.object({ date: isoDate }),
		(c, i) => call(router.netWorth.at, i, { context: c }),
	),
	tool(
		"get_asset_allocation",
		"Allocation of gross assets by class (cash, investments, real estate, ...).",
		Empty,
		async (c) => {
			const nw = await call(router.netWorth.current, undefined, { context: c });
			return {
				date: nw.date,
				baseCurrency: nw.baseCurrency,
				totalAssetsMinor: nw.totalAssetsMinor,
				allocation: nw.allocation,
				liabilityBreakdown: nw.liabilityBreakdown,
			};
		},
	),
	tool(
		"get_optimizations",
		"Savings missions with current and alternative monthly costs, annual potential, status and realized savings.",
		Empty,
		(c) => call(router.optimizations.list, {}, { context: c }),
	),
	tool(
		"get_contracts",
		"Contracts with costs, dates, linked payments, document metadata, completeness and missing fields.",
		Empty,
		(c) => call(router.contracts.list, undefined, { context: c }),
	),
	tool(
		"get_data_quality",
		"Portfolio data freshness, coverage score and incomplete contracts.",
		Empty,
		(c) => call(router.insights.quality, undefined, { context: c }),
	),
	tool(
		"get_recap",
		"Configurable historical report for net worth, assets, investable wealth, cash or liabilities.",
		RecapInput,
		(c, i) => call(router.insights.recap, i, { context: c }),
	),
	tool(
		"search",
		"Global search across transactions, accounts, assets, merchants and categories.",
		SearchInput,
		(c, i) => call(router.search, i, { context: c }),
	),
];

export function toolJsonSchema(t: McpTool): Record<string, unknown> {
	return toJsonSchema(t.input, { errorMode: "ignore" }) as Record<
		string,
		unknown
	>;
}

export { READ_ONLY };

/**
 * What an AI client with write access may change.
 *
 * Deliberately the same list the Copilot already works with: one definition of
 * what an agent may do to this data, reviewed once. It contains no delete, no
 * payment and nothing that touches credentials or provider connections — and
 * naming the tools explicitly, rather than opening every mutation, is what
 * keeps the Copilot itself, the bank sync and the provider keys out of reach.
 */
export const MCP_WRITE_TOOL_NAMES = [
	"create_transaction",
	"update_transaction",
	"create_category",
	"update_category",
	"create_categorization_rule",
	"update_categorization_rule",
	"create_recurring_payment",
	"update_recurring_payment",
	"create_contract",
	"update_contract",
	"create_account",
	"update_account",
	"record_account_balance",
	"record_cash_movement",
	"create_asset",
	"update_asset",
	"record_asset_valuation",
	"create_liability",
	"update_liability",
	"record_liability_balance",
	"create_receivable",
	"update_receivable",
	"record_receivable_balance",
	"create_optimization",
	"update_optimization",
	"upsert_fx_rate",
] as const;

const WRITE_HINTS = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
};

/** The write tools, resolved against the Copilot's definitions. */
export function mcpWriteTools(): McpTool[] {
	const byName = new Map(COPILOT_TOOLS.map((entry) => [entry.name, entry]));
	return MCP_WRITE_TOOL_NAMES.flatMap((name) => {
		const source = byName.get(name);
		if (!source) return [];
		return [
			{
				name: source.name,
				description: source.description,
				input: source.input,
				hints: WRITE_HINTS,
				execute: async (context: ORPCContext, raw: unknown) => {
					const result = await source.execute(
						(context.user as { id: string }).id,
						raw,
					);
					markDataChanged((context.user as { id: string }).id);
					return result ?? { ok: true };
				},
			},
		];
	});
}
