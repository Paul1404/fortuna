# Finance and data reference

## Architecture

```
browser (React, TanStack Router + Query)
   │  oRPC over /api/rpc            /api/auth (better-auth)   /api/export/*  /api/mcp
   ▼
src/server/orpc/router.ts           one typed router; `authed` = read, `mutation` = session only
   ▼
src/server/services/*               all database access, one file per domain, userId-scoped
   ▼                                 ▲
src/domain/*                        pure financial logic, no I/O, unit-tested
   ▼
src/server/db (Drizzle, PostgreSQL)

src/server/providers/bank/*         Enable Banking client → normalised accounts/transactions → insertTransactions
```

Every write of transactions, whether from CSV, a provider sync, manual entry or
the seed, goes through `insertTransactions`, which deduplicates, applies rules,
upserts merchants, links recurring payments, pairs internal transfers and rolls
the account balance forward. A provider outage therefore never affects data
already in Fortuna.

Enable Banking credentials are uploaded once under **Verbindungen**. The same
page lists supported German institutions, starts the PSD2 authorization flow
and imports the authorized accounts after the registered callback returns.
Subsequent syncs reuse the authorized session and follow all transaction pages.

Cash account pages support deposits, expenses, and counted-balance corrections.
These movements still use the central transaction
write path and therefore participate in categorisation, cashflow and net worth.

### Database model

- `user`, `session`, `account`, `verification` (better-auth) and
  `user_settings` (base currency, locale, analysis window).
- `accounts` with `account_balances` (dated observations),
  `bank_connections` (encrypted connection secrets) and
  `provider_credentials` (encrypted application private keys).
- `transactions` with `merchants`, `categories` (two levels),
  `categorization_rules`, `recurring_payments` and `import_jobs`.
  Unique per account on `(external_id)` and on the content `fingerprint`.
  Both legs of an internal transfer share `transfer_group_id`.
- `assets` with `asset_valuations`; `receivables` with
  `receivable_balances`; `liabilities` with `liability_balances`; `fx_rates`.
- `investment_source_accounts`, `investment_source_positions` and
  `investment_source_transactions` hold the synced broker depot.
- `contracts` with encrypted `contract_documents`;
  `copilot_memories` for explicit durable preferences and rules;
  `copilot_threads` for the current resumable Herr-Körner conversation.
- `financial_profiles` stores the owner's goal (name, amount, date), savings
  rate, minimum reserve, reserve months and target split (equity, bonds,
  cash, other), next to Hr. Körner's alert preferences.
- Unused since 0.59.0 and kept only until the owner confirms their drop:
  `budgets`, `scenarios`, `scenario_rules`, `account_projections`,
  `securities`, `security_prices`, `investment_positions`,
  `scalable_market_closes`, `investment_sync_runs`, `investment_policies`,
  `instrument_profiles` and `investment_decisions`. Nothing reads or writes
  them.

All money columns are integer minor units (`*_minor`); quantities and prices
are `numeric`. Every amount has an explicit currency.

### Investment process

"Anlegen" (`src/domain/capital-advice.ts`) is a deterministic proposal, not a
product recommendation. The reserve is one rule (`src/domain/reserve.ts`):
reserve months times monthly expenses, or the minimum reserve if larger, with
the monthly figure taken from full months of bookings only. A dip the
forecast sees below the reserve stays liquid too. Bank money above that
becomes a transfer ticket the owner carries out; free money is bought by the
gap of each class to the owner's target split, only into instruments already
in the depot, and never by selling. Recent market performance never enters.

The process is grounded in the SEC/Investor.gov guidance on
[asset allocation, diversification and rebalancing](https://www.investor.gov/additional-resources/general-resources/publications-research/info-sheets/beginners-guide-asset),
[ESMA's suitability requirement](https://www.esma.europa.eu/publications-data/questions-answers/1765)
to connect risk tolerance and ability to bear losses with the investor's
objective and financial situation, ESMA's work on the
[material long-term effect of costs](https://www.esma.europa.eu/press-news/esma-news/esma-report-stresses-impact-costs-retail-investor-benefits),
and the German Verbraucherzentrale guidance on
[risk capacity, asset classes and broad diversification](https://www.verbraucherzentrale.de/wissen/geld-versicherungen/sparen-und-anlegen/bevor-sie-geld-anlegen-das-kleine-einmaleins-der-geldanlage-10622).

### Metric definitions

Computed in `src/domain/net-worth.ts` and `src/domain/cashflow.ts` from
point-in-time values converted into the base currency:

- **Cash**: positive balances of current, savings and cash accounts, plus a
  provider-reported broker cash balance where available. Buying power and
  credit limits are not cash.
- **Investments**: investment account balances and the provider-reported
  broker portfolio value or valued provider holdings. Imported cost values can be
  estimates but still count. Quantity alone without a monetary value does not.
- **Provider precedence**: the official CLI snapshot takes priority over a
  row left by the removed CSV import. An explicitly linked manual account is
  suppressed to prevent double counting.
  Current provider values are not back-cast into earlier historical months.
- **Physical assets**: the latest valuation of each active asset.
- **Receivables**: the latest outstanding balance that another person owes the
  owner.
- **Liabilities**: negative account balances (credit cards, overdrafts) plus
  liability rows that are not mirrored by an account.
- **Net worth** = cash + investments + physical assets + receivables − liabilities.
- **Liquid net worth** = cash + investments − credit-card/overdraft balances.
- **Income / expenses**: booked transactions excluding internal transfers,
  categories of kind `transfer` and pending rows. Children roll up into their
  parent category. Savings rate = (income − expenses) / income.
- **Forecast**: liquid balance projected day by day from today with three
  separately reported layers: scheduled (pending transactions, certain),
  recurring (active recurring items by cadence, estimated) and irregular
  (average daily net of the remaining history, uncertain, with a widening
  band).
- **Optimizations**: current monthly cost minus an alternative, projected over
  one, three and five years after one-time switching costs. Potential savings
  never count as cash or net worth; completed missions track a time-proportional
  realized amount for motivation and reporting.

History is reconstructed, not snapshotted: an account balance at a date is the
nearest observation adjusted by booked transactions; assets, receivables and
liabilities use the newest history row at or before the date. Amounts in a
currency without a stored rate are excluded and the UI says so.

## Importing data

**CSV**: Imports → choose the account and file → the header is mapped
automatically (German and English bank exports, `;` or `,`, `1.234,56` or
`1,234.56`, separate debit/credit columns) and can be corrected → import.
Re-importing the same file skips existing rows.

**Bank connections**: Enable Banking is the only bank adapter. Its client and
key handling live in `src/server/providers/bank/`; nothing outside that folder
talks to a bank API. The generic adapter registry and its credential-free demo
provider were removed in 0.20.6 — the demo wrote synthetic transactions into
the real database and was never usable in production.

**Market data**: the broker depot is valued by the Scalable sync. Hand-entered
securities, prices and positions were removed in 0.59.0.

**Remise**: the connections page starts a public OAuth client with PKCE against
the hosted Remise MCP server and requests only `remise:read`. Access and refresh
tokens are encrypted in `external_connections`. A sync imports active inventory
as physical assets in the `Remise` section, using the internal target price or
approved asking price, and records later changes as market valuations.

**Kataster**: paste a read-only MCP token from Kataster Settings under
**Verbindungen**. Fortuna verifies it before storing it encrypted, then reads the
current monthly cost, billed amount, margin, readiness and operating status.
These figures appear under Verbindungen and Optimierung but never enter personal
accounts or net worth.
