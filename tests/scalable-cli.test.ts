import { describe, expect, it } from "vitest";
import {
	parseScalableCliBundle,
	ScalableSnapshotError,
} from "@/server/providers/investment/scalable-cli";

const identity = { account_id: "broker-account", portfolio_id: "portfolio-1" };
const bundle = {
	overview: {
		...identity,
		result: {
			valuation: { total: "4500.00", securities: "4500.00", crypto: "0" },
			timestamps: { valuation_timestamp_utc: "2026-09-17T08:00:00Z" },
		},
	},
	holdings: {
		...identity,
		result: {
			count: 1,
			items: [
				{
					isin: "IE00B4L5Y983",
					name: "Beispiel ETF",
					security_type: "ETF",
					quantity: "45",
					fifo_price: "90",
					valuation: "4500",
					valuation_currency: "EUR",
					quote_mid_price: "100",
					quote_currency: "EUR",
					quote_timestamp_utc: "2026-09-17T07:59:00Z",
					quote_is_outdated: false,
				},
			],
		},
	},
	cash: {
		...identity,
		result: {
			cash_balance: "69",
			buying_power: "500",
			available_credit_line: "1000",
		},
	},
	transactions: [
		{
			...identity,
			result: {
				cursor: null,
				items: [
					{
						id: "tx-1",
						summary_type: "BrokerSecurityTransactionSummary",
						last_event_datetime: "2026-09-17T07:00:00Z",
						security_transaction_type: "BUY",
						status: "FILLED",
						isin: "IE00B4L5Y983",
						quantity: "45",
						amount: "-4050",
						currency: "EUR",
						description: "Beispiel ETF",
					},
				],
			},
		},
	],
};

describe("official Scalable CLI projection", () => {
	it("maps priced holdings, cash balance and stable transaction IDs", () => {
		const parsed = parseScalableCliBundle(bundle);
		expect(parsed).toMatchObject({
			portfolioId: "portfolio-1",
			portfolioValueMinor: 450000,
			cryptoValueMinor: 0,
			cashBalanceMinor: 6900,
		});
		expect(parsed.positions[0]).toMatchObject({
			quantity: 45,
			valueMinor: 450000,
			costBasisMinor: 405000,
			valuationSource: "scalable_valuation",
			confidence: "provider_reported",
		});
		expect(parsed.transactions[0]).toMatchObject({
			sourceId: "tx-1",
			kind: "buy",
			amountMinor: -405000,
		});
	});
	it("keeps a provider-reported crypto aggregate separate from listed securities", () => {
		const parsed = parseScalableCliBundle({
			...bundle,
			overview: {
				...identity,
				result: {
					valuation: {
						total: "4700.00",
						securities: "4500.00",
						crypto: "200.00",
					},
					timestamps: { valuation_timestamp_utc: "2026-09-17T08:00:00Z" },
				},
			},
		});
		expect(parsed).toMatchObject({
			portfolioValueMinor: 470000,
			cryptoValueMinor: 20000,
		});
		expect(parsed.positions).toHaveLength(1);
		expect(parsed.positions[0].valueMinor).toBe(450000);
	});
	it("does not confuse buying power or credit with cash", () => {
		const parsed = parseScalableCliBundle({
			...bundle,
			cash: {
				...identity,
				result: {
					cash_balance: null,
					buying_power: "500",
					available_credit_line: "1000",
				},
			},
		});
		expect(parsed.cashBalanceMinor).toBeNull();
	});
	it("uses a quote or FIFO cost as an explicit estimate when provider valuation is absent", () => {
		const holding = bundle.holdings.result.items[0];
		const parsed = parseScalableCliBundle({
			...bundle,
			holdings: {
				...identity,
				result: { items: [{ ...holding, valuation: null }] },
			},
		});
		expect(parsed.positions[0]).toMatchObject({
			valueMinor: 450000,
			valuationSource: "scalable_quote",
			confidence: "estimated",
		});
		const unavailable = parseScalableCliBundle({
			...bundle,
			holdings: {
				...identity,
				result: {
					items: [
						{
							...holding,
							valuation: null,
							quote_mid_price: null,
							fifo_price: null,
						},
					],
				},
			},
		});
		expect(unavailable.positions[0]).toMatchObject({
			valueMinor: null,
			confidence: "unavailable",
		});
	});
	it("rejects a snapshot whose parts belong to different accounts", () => {
		expect(() =>
			parseScalableCliBundle({
				...bundle,
				cash: { ...bundle.cash, portfolio_id: "other" },
			}),
		).toThrow(ScalableSnapshotError);
		expect(() =>
			parseScalableCliBundle({
				...bundle,
				holdings: { ...identity, result: {} },
			}),
		).toThrow(ScalableSnapshotError);
	});
	it("rejects a holdings list in which no row is usable", () => {
		expect(() =>
			parseScalableCliBundle({
				...bundle,
				holdings: { ...identity, result: { items: [{ name: "No ISIN" }] } },
			}),
		).toThrow(/No usable holding/);
	});
	it("skips an unusable or repeated row instead of losing the depot", () => {
		const holding = bundle.holdings.result.items[0];
		const tx = bundle.transactions[0].result.items[0];
		const parsed = parseScalableCliBundle({
			...bundle,
			holdings: {
				...identity,
				result: {
					items: [holding, { name: "No ISIN" }, { ...holding, quantity: "1" }],
				},
			},
			transactions: [
				{
					...identity,
					result: {
						cursor: "next",
						items: [tx, { ...tx, id: "tx-2", last_event_datetime: null }],
					},
				},
				{
					...identity,
					result: { cursor: null, items: [{ ...tx, amount: "-4000" }] },
				},
			],
		});
		expect(parsed.positions).toHaveLength(1);
		expect(parsed.positions[0].quantity).toBe(45);
		expect(parsed.transactions).toHaveLength(1);
		expect(parsed.transactions[0].amountMinor).toBe(-405000);
		expect(parsed.warnings).toEqual({
			skippedHoldings: 1,
			duplicateHoldings: 1,
			skippedTransactions: 1,
			conflictingTransactions: 1,
			reconciliation: "parts",
		});
	});
	it("takes cash out of a total that already contains it", () => {
		const parsed = parseScalableCliBundle({
			...bundle,
			overview: {
				...identity,
				result: {
					valuation: { total: "4569.00", securities: "4500.00", crypto: "0" },
					timestamps: { valuation_timestamp_utc: "2026-09-17T08:00:00Z" },
				},
			},
		});
		expect(parsed.warnings.reconciliation).toBe("with_cash");
		expect(parsed.portfolioValueMinor).toBe(450000);
		expect(parsed.cashBalanceMinor).toBe(6900);
	});
	it("keeps Scalable's total and says so when it does not add up", () => {
		const parsed = parseScalableCliBundle({
			...bundle,
			overview: {
				...identity,
				result: {
					valuation: { total: "4500", securities: "4000", crypto: "0" },
					timestamps: { valuation_timestamp_utc: "2026-09-17T08:00:00Z" },
				},
			},
		});
		expect(parsed.warnings.reconciliation).toBe("unreconciled");
		expect(parsed.portfolioValueMinor).toBe(450000);
	});
});
