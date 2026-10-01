# Repository guidance

`AGENTS.md` is the canonical instruction file for Fortuna. Claude Code loads it
through `CLAUDE.md`. Read it before changing code.

The source is public, all rights reserved, with fresh reviewed history. Earlier
history remains privately archived and must never be merged here. Runtime
financial data and credentials stay private. See `docs/publication.md`.

## What this is

Fortuna is a private, single-user personal-finance and net-worth application:
accounts, transactions, categorisation rules, fixed costs (recurring payments,
contracts, Sparmissionen), cashflow and forecasting, manually valued assets with valuation history,
receivables and liabilities with balance history, investments, net worth over time, CSV
import/export and a read-only MCP endpoint. It reads and reports; it never
moves money on its own. The one exception, the owner's decision of
26.09.2026, is a Scalable order the owner confirms after seeing Scalable's
full preview (see "Orders at Scalable").

Stack in one line: TanStack Start (Vite 8, Nitro) + React 19, oRPC procedures
validated with Valibot, Drizzle on PostgreSQL, better-auth, Tailwind v4, Bun,
Biome, Vitest. Deployed on Railway via the Dockerfile.

## Layout you actually need

- `src/domain/` - pure financial logic with no I/O: money and FX, dates,
  normalisation and dedupe fingerprints, categorisation rules, transfer
  pairing, recurring detection, cashflow aggregation, forecast, net worth,
  CSV parsing. Unit tests in `tests/` target this layer. Put new calculations
  here first, then call them from a service.
- `src/server/services/` - one file per domain, all DB access, called by oRPC
  procedures, the MCP tools, the seed and the migrator. Every function takes
  `userId` as its first argument.
- `src/server/orpc/router.ts` - the whole API. `authed` procedures may be
  called by the browser session or the MCP token; `mutation` procedures stay
  session-only. MCP write access is deliberately NOT a principal that unlocks
  every mutation — it is the explicit `MCP_WRITE_TOOL_NAMES` allowlist,
  resolved against `COPILOT_TOOLS`, so one reviewed definition covers both
  agents. Opening all mutations would hand an AI client the Copilot itself,
  the bank sync and the provider credentials, all of which are mutations.
- `src/server/db/schema.ts` - Drizzle tables. `auth-schema.ts` holds the
  better-auth tables. Migrations live in `drizzle/`.
- `src/server/providers/bank/` - the Enable Banking client and key handling.
  Only this folder may talk to a bank API. There is no market-data adapter:
  securities come only from the Scalable depot.
- `src/routes/` - file-based routes. `_app.tsx` is the authenticated layout
  (session guard, settings, sidebar, command palette). `routeTree.gen.ts` is
  generated; never edit it (run `bun run generate-routes`).
- `src/lib/schemas.ts` - Valibot schemas shared by procedures and forms.
- `fortuna-brand/` - the brand package. `src/styles.css` maps its tokens onto
  Tailwind; do not invent colours or type styles outside it. The two files are
  kept in step by hand, so a palette change belongs in both, and the contrast
  table in `colors/fortuna-colors.json` is measured, not estimated.
- `src/components/hero-panel.tsx` - the lit navy surfaces. `HeroPanel` is the
  deep gradient panel with its drifting blooms, `HeroRing` the dotted gauge,
  `HeroAction` one circular quick action, `HeroStat`/`HeroLabel` the figures
  on it. Used by the dashboard and the account detail header.

## Domain rules that save time

- `/` is Hr. Körner's desk and the only home. The desk renders `desk.today`
  (`src/domain/desk.ts`) and works out no task itself: "Heute zu tun", the
  liquidity structure (built from `currentNetWorthInput`, so it adds up to
  total assets) and lazy cash (the "Anlegen" plan's `bankFreeMinor`). Money
  has one task, "Freies Geld", naming bank money above what stays liquid
  (from 500 €) and free depot cash (from 50 €); its one action opens
  "Anlegen". Nothing moves money without the owner's confirmation.
  "Erledigt" on the transfer lives only in the browser
  (`fortuna-desk-done-v1`, 3 days). `NetWorthHero` is rendered by the desk
  only. The chat exists once, in `src/components/copilot-chat.tsx`; the
  message list scrolls itself, never with `scrollIntoView`, or the desk jumps
  to the chat.
- Übersicht and Rückblick were merged into Vermögen (`/net-worth`): KPIs,
  one history chart with metric, interval, period and mode pickers (saved
  views stay under `fortuna-recap-views-v1`), change by period, and the
  holdings Sankey. `/overview` and `/recap` redirect. Connections and CSV
  import/export live under Einstellungen › Datenquellen
  (`/settings/data-sources`); the bank and Remise callbacks redirect there. A
  cash account's spend and count forms sit on its account page; there is no
  Bargeld page. "Liquide Mittel" is the one word for cash-like money.
- Money is stored and computed as integer minor units (`*_minor` columns,
  `bigint` mode number). Never use floats for amounts. Quantities and unit
  prices are `numeric`.
- Every amount carries a currency. Aggregations convert through
  `FxTable` (`src/domain/fx.ts`) into the user's base currency and report
  currencies they could not convert instead of summing them.
- Transactions are deduplicated per account by `external_id` when the source
  provides one and always by the content `fingerprint` (date, amount,
  currency, normalised description, counterparty IBAN). Re-importing a file
  is a no-op. `insertTransactions` is the single write path for CSV, provider
  sync, manual entry and the seed; it runs rules, merchants, recurring links,
  transfer pairing and the balance roll-forward.
- An account's `current_balance_minor` is "the balance as of
  `balance_as_of`". Inserted transactions dated after that move it forward;
  older rows do not. `account_balances` holds observations; history is
  reconstructed from observations plus booked transactions.
- A policy or insurance surrender value is a factual asset represented by its
  own `investment` account and linked from the contract. Never attach its
  projection to an unrelated cash, current, or investment account.
- The authenticated app layout silently calls `connections.syncDue` once when
  it mounts. Nothing else starts a bank sync: there is no cron, so every read
  happens while the owner is in the app. Fortuna therefore forwards the
  browser's PSU presence headers, which PSD2 exempts from the four-reads-a-day
  limit on background access. A connection whose bank accepts those headers is
  due again after five minutes; one whose bank rejects them falls back to six
  hours so four reads cover the day. The service coalesces concurrent manual
  and automatic syncs and never uses expired consent. After a failed sync,
  automatic retries wait an hour; the manual Abgleichen action remains
  available immediately. Never log the PSU address or agent, a provider
  response body or credentials — only a safe error class and HTTP status.
- The batch review groups by merchant and direction: one decision for all of a
  merchant's open bookings, with the individual rows one click away. Fifteen
  eBay bookings meant fifteen identical dropdowns.
- A booking text that says nothing — the ISO domain code, the account holder's
  own name, or nothing at all — must never become a merchant
  (`isEmptyBookingText`), or the review concludes "all 3 earlier bookings from
  X are Y" about a merchant that does not exist. Such a text is also the only
  one a re-sync may overwrite, which is what makes the refresh safe without a
  flag proving the owner did not write it.
- Uncategorised bookings are cleared in one batch review on `/transactions`
  (`src/domain/categorisation.ts`). A proposal is pre-ticked only when it
  repeats a decision the owner already made — their rule, their merchant
  default, a recurring payment, or an unbroken run of the same category for
  that merchant and direction. Anything resting on a guess starts blank.
  Repeat decisions are applied without asking (the owner's choice,
  26.09.2026): `desk.fileCertain` (on the desk and after a bank import)
  writes every `certain` proposal to uncategorised, non-manual bookings as
  `category_source = auto` and reports them with undo. `desk.unfile` clears
  only rows still `auto`; `auto` is written solely with its category and
  every other change also changes the source, so "still auto" means
  "untouched". Rules and detection may overwrite `auto` like any non-manual
  source, and an owner edit makes it `manual`. Guesses are never written:
  they stay proposals until the owner confirms them, everything the owner
  confirms becomes `manual`, and which merchant a pick belongs to is read
  back from the database rather than taken from the request.
- Filing a booking includes creating the category it needs. Every category
  picker in the review offers "Neue Kategorie" inline; sending the owner to
  Einstellungen loses the review and their place in it.
- Where the deterministic tiers run out, the review is a conversation with Hr.
  Körner, not a verdict. He may propose categories the owner does not have —
  with a short category list, mapping everything onto it is wrong far more
  often than admitting a new one is needed — and he may ask instead of guess;
  the owner answers and he continues on the same thread. Sessions are
  in-process, expire after 30 minutes, and are keyed to the user.
  It is a conversation that runs until nothing is open, not a single verdict:
  every follow-up carries the list that is still open — recomputed, minus what
  the owner has settled in the browser — because the thread remembers what it
  was first told but not what was decided since. Every open merchant gets
  either an assignment or a question, never nothing: permission to skip left
  the largest merchant untouched.
  It runs only on a press (it spends a model call, so the procedure is
  session-only), on an isolated tool-free thread that is never stored in
  `copilot_threads` and leaves no turns in the owner's chat, and it asks once
  per merchant rather than per booking. The answer is untrusted:
  `parseConsultation` keeps only merchants that were asked about, bounds and
  strips every string it will render, and never lets one merchant be both filed
  and questioned. Nothing he proposes is written — a new category exists only
  once the owner presses Anlegen, and his assignments fill the form without
  ticking anything. A failed turn must reject — an empty answer and a broken
  App Server are not the same thing — and the provider's raw message never
  reaches a log or the owner.
- PayPal reports only outgoing payments over PSD2, never the funding coming in.
  The bank's "PayPal" debit and PayPal's payment to the merchant are therefore
  the same money twice, and both counted as spending. `matchPaypalFunding`
  pairs them — both legs are outflows, which is why the ordinary transfer
  detection cannot — and `linkPaypalFunding` categorises the bank leg as a
  transfer, which is what it is. The PayPal leg stays as the expense because it
  is the one naming the merchant. Never touch a booking whose
  `category_source` is `manual`.
- Both legs of an internal transfer share `transfer_group_id`; cashflow and
  recurring detection ignore them, as they ignore categories of kind
  `transfer`. Manual categories (`category_source = manual`) are never
  overwritten by rules or detection.
- Detection groups by merchant, and retries a failed group split by the
  purpose: one merchant bills for more than one thing, and a mobile contract
  at ~35 € beside a TV subscription at 10 € looks erratic together and clean
  apart. The whole-merchant group is tried first and its parts only get the
  bookings it did not take, so no booking lands in two payments. The split key
  comes from the purpose, never the amount, so it survives a price change.
- `amountLevels` separates the price in force now from the one before it. The
  expected amount is the current level, not the median across a rise — that
  median sits between the two and projects an amount never charged — and a
  clean move to a new level is reported as a `priceChange` rather than absorbed
  in silence. The tolerance is deliberately tight: a fixed price repeats to the
  cent, and a wide window swallows exactly the small rises worth catching.
- Recurring items detected automatically carry `match_key`; re-running
  detection refreshes amounts and dates but keeps user edits to name, category
  and subscription flag. Manual items have no match key.
- Net worth definitions live in `src/domain/net-worth.ts` and the README.
  A liability with `linked_account_id` contributes no balance (the credit card
  account already does); this avoids double counting.
- Assets, receivables and liabilities keep history tables. The value on the
  parent row is a denormalised copy of the newest history row and is synced
  by the services; write history, not the parent, when adding a point.
- Assets and debts are shown as sheets: tabs by category group, then
  user-named `section`s with subtotals, inline add rows and click-to-edit
  values (`src/components/sheet.tsx`). An inline value edit writes a dated
  history row (valuation or liability balance), never a bare update.
  Forderungen and Verbindlichkeiten are the two tabs of `/debts`
  (`src/components/receivables-sheet.tsx`, `liabilities-sheet.tsx`).
- `is_active` means the same thing everywhere: an inactive account, asset or
  receivable is gone from its list, from that list's total and from net worth.
  Accounts used to be the exception, so money vanished from `/accounts` and
  stayed in `/net-worth`.
- Receivables are positive assets for money another person owes the owner.
  Record every partial repayment in `receivable_balances`; a zero latest
  balance closes the receivable and removes it from current net worth.
- The forecast reports scheduled (pending transactions), recurring and
  irregular components separately. Do not collapse them into one number.
  The irregular baseline uses the cashflow report's definition of spending:
  paired transfers and categories of kind `transfer` are left out, and the
  average runs over the days that have bookings, not the whole window. It
  once counted broker deposits and card settlements as consumption, so the
  capital advice held back depot cash for a dip that was the owner's own
  investing.
- A contract is a forecast source in its own right. Detection can never infer a
  yearly payment — one or two bookings give no cadence — so a contract with a
  cost, a cadence and a start date is projected from `contractForecastEntry`,
  anchored on its start date and stopping at its end. A contract whose linked
  recurring payment is active is skipped, or the same money is counted twice.
  A contract that cannot be projected is reported in `assumptions.contractGaps`
  with the reason, never dropped in silence.
- Contract and bookings answer different questions: the contract is what was
  agreed, the recurring payment what actually leaves the account. Show both
  where they diverge rather than picking one — a gap is usually a price rise
  nobody announced.
- Goal (name, `target_net_worth_*`), savings rate, minimum reserve, reserve
  months and the target split (equity/bonds/cash/other in bps, totalling
  10 000; the service refuses a split that doesn't) live once, in
  `financial_profiles`. The reserve is one rule, `requiredReserve` in
  `src/domain/reserve.ts`: max(reserve months × monthly expenses, minimum).
  Monthly expenses come only from full calendar months once three exist;
  before that from recurring payments, else only the minimum, with a
  sentence saying which. The desk, "Anlegen", Hr. Körner's observations and
  the purchase estimate all use it. Never add a second reserve formula.
- Scalable's hosted MCP rejects Fortuna's web OAuth redirect until allowlisted.
  The in-app official CLI device-code flow is the only supported path; the
  local relay and the CSV upload were removed in 0.20.6 because they were
  untested duplicates of it. The read connection runs only fixed read commands
  in a private memory-backed workspace; its full-permission session and signing key
  are AES-GCM encrypted in `external_connections` and never logged or exposed
  through Copilot/MCP. `--local-read-only` is not a token scope. Valued holdings
  and cash count in net worth even when estimated or stale; suppress an
  explicitly linked manual account to avoid double counting. See
  `docs/integrations/scalable-capital.md`.
- The Scalable depot shown under Konten is a read-only view of selected
  `investment_source_accounts`, never a duplicate row in `accounts`. Its
  holdings and paginated broker activity come from the existing source tables;
  only the source snapshot contributes to net worth. Keep broker transactions
  separate from bank cashflow. Scalable's overview may report aggregate crypto
  absent from `broker holdings`: preserve and display that provider-reported
  subtotal separately, without inventing individual coin positions or adding
  it on top of the already inclusive portfolio total.
- The Scalable market pulse uses only the official CLI `broker holdings` read
  on a visible authenticated page: one real reading every 15 s
  (`TICK_INTERVAL_MS`), cached and coalesced per user on the server, with
  error backoff. Its per-position quotes produce an indicative overlay against
  the latest confirmed source snapshot only when quantity and priced baseline
  match. Never mutate booked net worth. Every figure that moves with the
  quotes shares one subscription (`useMarketPulse`): the dashboard hero, the
  sidebar net worth, the Nettovermögen tile and the depot page's total,
  holdings and gains, each applying the overlay only to the snapshot the
  pulse was computed for (`indicativeNetWorth`, `depotIndicative`).
  Between readings the figure ticks every second on a simulated path — the
  owner's explicit choice (26.09.2026), display only and never stored or used
  in a calculation. The path is a Brownian bridge (`bridgePath` in
  `src/domain/market-ticker.ts`) from what is on screen to the new real value,
  landing two steps early so every reading is shown exactly. Its wobble comes
  only from real moves between readings (`tickAmplitude`): the shift from the
  booked snapshot to the first quote is not a move, and when the last two
  readings did not move nothing wobbles, so a closed market stands still. No
  colour flash: the owner wants the plain figure moving. Reduced motion shows
  the real values only. A holding's value and gain tick from one path
  (`LiveValueCells`), never two. The
  separate daily close is captured only on a visit after 22:15 Berlin with
  complete fresh data; a missing day remains missing.
- A Scalable sync failure is classified by `classifyScalableSyncFailure`
  into a code that is safe to log and a sentence that tells the owner what to
  do. `ScalableCliError` carries the exit status, a timeout, or the `--json`
  envelope's own error code when it is a bare identifier. The CLI's codes are
  snake_case (`refresh_relogin_required`, `no_session`) and are upper-cased;
  a filter for capitals alone dropped every one of them. Exit statuses follow
  `sc capabilities --json`: 10 validation, 20 auth or config, 30 network or
  backend. Exit 20 means "reconnect" whatever the envelope says, never "wait";
  0.51.0 told the owner to wait an hour for a session that was gone.
- A Scalable snapshot is rejected only for its account-level contract:
  envelope shape, matching account and portfolio IDs, present lists. A single
  unusable holding or booking is skipped and counted in
  `ScalableSnapshotWarnings`, shown through `scalableSyncWarning` and logged as
  counts; the first row of a repeated ISIN or booking ID wins. Since
  23.09.2026 the overview `total` is no longer securities + crypto, and the
  old hard check cost the whole depot for two days. `reconcileTotal` decides:
  a total that equals securities + crypto + cash contains the cash, which
  Fortuna counts on its own, so the depot value is then securities + crypto;
  any other gap keeps Scalable's total with a visible warning. A holdings
  list in which no row is usable still rejects the snapshot: that is a
  changed format, and accepting it would delete every stored position.
- The Scalable CLI refreshes its session files before it reads. A failed read
  still stores changed files (`keepRotatedSession`), or the next sync looks
  like an expired login. `lastError` on `external_connections` and
  `investment_source_accounts` holds finished German sentences rendered as
  stored; never add text around them. A Scalable toast belongs to an attempt
  that finished during the visit (`scalableSyncNotice`); a stored `lastError`
  while the status is `active` is a warning from a successful sync.
  A rejected snapshot logs its validation label, which is Fortuna's own wording
  about structure and never a provider value. Do not collapse these into one
  generic code again: the outage of 23.09.2026 sat for two days as
  "CLI_READ_OR_STORAGE_FAILED" with no way to tell an expired session from a
  changed output format. stderr stays drained and unlogged.
- Scalable CLI transactions are keyed by account and provider ID. A repeated
  ID with unchanged content is a no-op; a same-kind/ISIN/currency correction
  archives the prior encrypted transaction in
  `investment_source_transaction_revisions` before updating it. A changed
  identity is held as a visible sync warning while holdings and cash still
  refresh. Log only safe error codes and counts, never raw provider records.
- An institution is identified by name **and** country. `/aspsps` was asked
  only for `country=DE`, which made every provider licensed elsewhere invisible
  — PayPal Europe is Luxembourg, Revolut Lithuanian, bunq Dutch. The picker now
  reads `INSTITUTION_COUNTRIES`, `bank_connections.institution_country` stores
  what was chosen, and the PSU-header lookup uses both: finding nothing there
  falls back to "no headers required", which silently drops the presence
  headers and with them the exemption from the four-reads-a-day limit.
- An Enable Banking production application runs in restricted mode until a full
  production contract exists, and then returns only the accounts linked in its
  Control Panel. A bank whose account was never linked authorizes the consent
  normally and returns an empty `accounts` array, which reads exactly like a
  broken integration. Link the account there first; no code change reaches it.
  A consent's account list is also fixed when the bank grants it, so a newly
  linked account needs a new authorization.
- The Enable Banking `/auth` `access` object must name `balances` and
  `transactions`. Sending only `valid_until` leaves the scope to the bank, and
  some grant nothing but the account list: the consent then comes back
  `AUTHORIZED` with an empty `accounts` array and no data can be read.
- Enable Banking HTTP 429 after a background read can mean the bank's daily
  access limit. Persist a six-hour automatic retry delay for this case, retain
  the last bank balances, and show only a sanitized error plus retry time.
  During that cooldown, block manual reads as well so a button or direct call
  cannot hammer the provider. Do not log provider response bodies.
- MCP clients authenticate with a token from `mcp_tokens`: stored hashed,
  named, scoped and revocable, with the plain value shown exactly once. The
  static `MCP_BEARER_TOKEN` still works and is always read-only, because a
  value that cannot be withdrawn must not be able to write. A revoked token is
  kept as a row so it is refused rather than falling through to the
  environment token. A read token never sees a write tool listed.
- Sidebar visibility lives in `user_settings.hidden_nav_items`, keyed by stable
  navigation hrefs and validated against the current menu. Overview, Settings
  and the menu editor must remain visible so hidden areas can be restored.
  The menu (27.09.2026): Hr. Körner, Vermögen, Konten & Depots, Sachwerte,
  Forderungen & Schulden, Umsätze, Zahlungsfluss, Fixkosten, Anlegen,
  Einstellungen. Merged pages keep redirect routes, listed in
  `scripts/smoke-routes.ts`; pages that left the menu go in
  `PALETTE_ONLY_ITEMS`, and saved hidden hrefs pass through `hideableOnly`.
- Account details page through the full account transaction history. The global
  Transactions page shows bank and selected broker activity in separate,
  independently paginated lists. Broker activity is not added to bank cashflow
  or bank transaction sums; date and direction filters may cover both, while
  bank-specific filters exclude the broker list visibly.
- "Anlegen" (`src/domain/capital-advice.ts`, `planInvestment`) is the
  waterfall: reserve, a dip the forecast sees below it, the split's cash
  share (the reserve counts towards it), then buys by each class's gap to
  target, only into instruments already held, in whole euros. Buys only,
  never a sale. A class without a holding is named and its money stays. Bank
  money above what stays liquid becomes one transfer ticket from the largest
  base-currency current or savings account, never more than that account
  holds. Each buy opens the broker-order dialog; no model is involved and no
  ticket is stored. `update_investment_targets` (Copilot) writes the
  profile's goal, reserve and split; the MCP tool `get_investment_process`
  returns the read-only "Anlegen" proposal.
- Orders at Scalable (the owner's decision of 26.09.2026, deliberately
  without an amount limit): `src/server/services/broker-orders.ts`.
  - Trading uses a second, separate device login without `--local-read-only`
    (`external_connections.provider = scalable_trading_cli`), started only by
    the owner under Verbindungen and revoked by "Handel sperren". Every read
    keeps the read-only connection; the read workspace keeps
    `allowed_isins = []`.
  - Only instruments already in the Scalable depot, never more shares than
    held (`validateOrderRequest`). Market orders only: buy by amount, sell by
    shares. `allowedTradeArgs` admits exactly `broker trade buy|sell` with
    those arguments and, in phase 2, `--confirm <id>` (plus
    `--acknowledge-appropriateness-warning` for a buy the owner
    acknowledged); nothing else, no cancel, no savings plans, no venue.
  - Each order runs in its own workspace whose `[trade_controls]` allow
    exactly its ISIN and, for a buy, `max_order_notional` = the confirmed
    amount + 1 % (a string; the CLI refuses a TOML float). That binds the
    submission to what was confirmed; it is not an owner limit.
  - The CLI's rule `pre_trade_full_disclosure_v1` is law here: phase 1's
    every required field (`requiredLeafPaths`, pinned to CLI v1.1.0 by
    `tests/fixtures/scalable-trade-leaves.json`) is shown unchanged, null as
    `null`, missing as "(nicht geliefert)", and phase 2 runs only from the
    owner's separate confirmation (the dialog's button plus `confirm()`),
    never automatically. A required warning must be acknowledged first.
  - `broker_orders` logs every preview and submission; preview and result
    are encrypted, only safe codes are logged. A confirmation is used once
    (status guard `previewed → submitting`), and a failed or unclear
    submission triggers a read-back sync. The procedures are `mutation` /
    `sessionRead` only and must never enter `COPILOT_TOOLS` or
    `MCP_WRITE_TOOL_NAMES`.
  - Agents building on this test only against a simulated CLI
    (`tests/integration/broker-orders.test.ts`) and never place a real order.
  - A sale requires a reason ("Warum jetzt?", the owner's decision of
    28.09.2026): `sellReasonProblem` in `src/domain/investment-rules.ts`,
    10–500 characters, checked before anything reaches the CLI, stored in
    `broker_orders.sell_reason`, shown in the order log, never logged and
    never passed to the CLI. The dialog shows the owner's own rules
    (`financial_profiles.investment_rules`, their words, examples only as a
    placeholder) and prompts, but does not block, when there are none. The
    rules are read only through session-only `hrKoerner.investmentRules` and
    never enter the Copilot snapshot or MCP. Buys are unchanged. Nothing in
    the UI opens a sell ticket yet, deliberately.
- Investment guidance starts from the owner's goal, reserve and target split.
  Never infer a recommendation from recent performance or market timing.
- A contract owns the dates; the recurring payment and the Sparmission that
  reference it borrow them. Never branch on `contracts.status`: ask
  `src/domain/contract.ts` for the phase. `cancelled` still costs its old price
  until `end_date`, an `end_date` in the past ends a contract whatever the
  stored status says, and `cancellation_date` is the day notice was given, not
  the day the money stops. A recurring payment stops at its contract's end.
- A Sparmission's saving starts when the old contract actually ends, not when
  it was ticked off, and it reports a phase rather than a bare euro figure:
  waiting for the old contract, earning back the switching fee, then saving.
  Never show a negative "Bereits gespart" and never show a positive one the
  owner has not got yet; show what is still outstanding and the date it turns.
  `savingStartDate` owns this: the day after the linked contract's end, or
  `optimizations.saving_from` when none is linked; never `completed_at`.
  Without either the phase is `undated` and nothing counts.
- Fixkosten (`/fixed-costs`, `src/domain/fixed-costs.ts`) groups a recurring
  payment, the contract naming it and its Sparmissionen into one item. The
  booked amount leads and a divergence from the contract stays visible. A
  payment with no linked booking says so, and `recurring.linkMatches` links
  only matching unlinked bookings, recomputed on the server. `/recurring`,
  `/contracts` and `/optimizations` redirect there.
- Optimizations are motivational cost comparisons, not booked money. Calculate
  projections from monthly current/alternative costs and one-time switching
  costs; never add potential or realized optimization figures to net worth.
- Contracts compute completeness from provider, contract number, cost and
  cadence, dates, links and documents. Insurance requires a `policy` document
  for 100 percent. Document bytes and extracted text are AES-GCM encrypted in
  PostgreSQL; never expose encrypted content or extracted text through lists,
  MCP or logs.
- Long-term behaviour features (owner's decisions of 28.09.2026):
  - Down days are framed, not hidden: `heroFraming` in
    `src/domain/market-framing.ts`. When the pulse puts the depot below the
    confirmed snapshot, the hero's date line shows the change since a year
    ago (else the depot against cost, else the date), in the same muted
    colour. The ticker itself never changes with the direction.
  - `growthBreakdown` (`src/domain/progress.ts`) splits a period's change
    into Eigene Sparleistung (exactly the cashflow report's net, so the two
    pages never disagree), Markt & Bewertung (asset revaluation plus the
    depot's change minus net deposits) and Sonstiges (the remainder, never
    forced to zero). Past net worth has no depot, so never read the depot's
    whole value as growth. The savings streak counts full calendar months
    only, like `monthlyExpenseBasis`.
  - The reserve pot is `reservePot(bankCashMinor, reserveFor(...))`, never
    a second reserve formula; it rounds down and says "voll" only when
    covered.
  - The monthly recap (`src/domain/monthly-recap.ts`) is composed by rule,
    never by a model. It shows on the desk on days 1–10
    (`RECAP_VISIBLE_DAYS`) until a `desk_recap_reads` row exists; history
    lives under `/hr-koerner`. A month is covered only if data starts by its
    4th day and has at least 5 bookings.
  - Lifestyle creep (`detectLifestyleCreep`) compares fixed costs against
    income by calendar quarter (`lifestyle_creep:YYYY-Qn`, once per
    quarter), needs 6 full months and is an `info` finding.
  - `contracts.paid_via = payroll` (Entgeltumwandlung) means the employer
    pays. Such a contract, and a recurring payment linked to it
    (`payrollRecurringIds`), is never counted in Fixkosten, forecast,
    flagged for missing bookings or asked for an account link.
- Unused since 0.59.0 and dropped only after the owner confirms: `budgets`,
  `scenarios`, `scenario_rules`, `account_projections`, `securities`,
  `security_prices`, `investment_positions`, `scalable_market_closes`,
  `investment_sync_runs`, `investment_policies`, `instrument_profiles`,
  `investment_decisions`. Their Drizzle definitions stay (marked) so no
  migration is generated; nothing reads or writes them.

## Commands

- `bun run dev` - Vite dev server on http://localhost:3000.
- `bun run verify` - `check` (Biome) + `typecheck` + `test` + `build`. Run
  before pushing.
- `bun run test` - Vitest unit tests (`tests/**`, excluding integration).
- `bun run test:integration` - needs PostgreSQL; reads `DATABASE_URL` from
  `.env` (or the environment) and sets `FORTUNA_INTEGRATION_TEST=1`.
- `bun run db:generate` - create a migration from schema changes.
  `bun run db:migrate` - apply migrations and create the owner from
  `OWNER_*`. `bun run db:seed` - realistic demo dataset (wipes that user's
  data first). `bun run db:reset` - drop and recreate the dev database.
- `bun run generate-routes` after adding or renaming a route file when the
  dev server is not running.

## Deployment

- Railway project `fortuna`, service `fortuna-app`, defined in
  `.railway/railway.ts` (TypeScript IaC; `railway.toml` config-as-code is
  deprecated and must not come back). `railway config plan` before any
  `railway config apply`; never apply from an agent session without the
  user reading the plan.
- Every push to `main` deploys to production with check suites disabled;
  prove changes locally first. The pre-deploy migrator aborts the release on
  failure.
- Secrets are `preserve()`d in IaC and live only in Railway.
- User-uploaded provider application keys live in `provider_credentials`, are
  validated server-side, encrypted through `src/server/crypto.ts`, and are
  never returned, logged or exposed through MCP. Keep uploads on a bounded,
  same-origin, browser-session-only route rather than an oRPC JSON procedure.
- Enable Banking API calls sign five-minute RS256 JWTs inside the server. Never
  return or log the PEM or JWT; diagnostics return only sanitized application
  and provider-coverage metadata.
- Enable Banking authorization state is stored as a pending bank connection.
  The public callback exchanges the returned code, stores only the encrypted
  session id/account ids, then sends every account and transaction through the
  existing balance and `insertTransactions` paths. Follow continuation keys.
  Never name an account from the provider's `name`: banks answer it with the
  account holder, so every connected account came back called "Alex Beispiel".
  `providerAccountName` names it after the institution and only adds the
  product, the account type or a reference suffix when another account would
  otherwise carry the same name.
  Account UIDs are session-specific: when consent is renewed, match an existing
  Enable Banking account by `accounts.provider_account_ref` and currency before
  creating another account, and never let an older session reclaim it. That
  reference is the IBAN where there is one and the provider's `other`
  identification where there is not — PayPal has no IBAN and is reported under
  scheme OTHI with the owner's email, so matching on IBAN alone made it
  unrecognisable and added another PayPal account at every 90-day renewal. Use the
  granted `access.valid_until` for expiry rather than the requested date. A
  callback can succeed at session exchange but fail during its first sync;
  persist a sanitized error on that active connection. Log only sync stage,
  safe error class/code and provider HTTP status, never raw exception text.
  A pending authorization stores state but no session account IDs: reject manual
  sync until the callback finishes, including after a previous erroneous retry.
- Remise uses a public OAuth client with PKCE and only `remise:read` against
  `https://app.remise.pdcd.net/mcp`. Store tokens encrypted in
  `external_connections`. Remise items use stable `remise:<slug>` asset
  references and valuation history; do not replace them with ad-hoc imports.
  Provider identity lives in `assets.sync_source` and `assets.external_id` so
  manually curated names, categories, sections, costs and references survive.
  Auto-link only an unambiguous existing asset; ambiguous matches stay separate.
- Kataster connects through its read-only MCP endpoint at `/api/mcp`. Accept the
  token only through the bounded same-origin session route, verify it before
  storage, encrypt it in `external_connections`, and never return or log it.
  Kataster cost and margin figures are an operational view only and must never
  contribute to accounts, transactions or net worth.
- Fortuna Copilot runs the pinned `@openai/codex` App Server in a scrubbed child
  environment and authenticates with ChatGPT's device-code flow. Persist only
  its encrypted `auth.json` in `external_connections`; never return or log raw
  tokens. Turns run in the empty Copilot workspace with restricted read-only
  access and receive only a bounded financial snapshot without IBANs. Dynamic
  tools may create and update Fortuna domain records, but must validate with the
  shared Valibot schemas, stay inside the session-only Copilot mutation, expose
  no delete or external-payment operations, and treat imported text as untrusted
  data. Fortuna's read-only MCP must not be able to invoke the Copilot.
- Keep one resumable App Server thread per user in `copilot_threads`. Register
  the full safe Fortuna tool surface only when starting that thread, with
  non-core tools marked `deferLoading` inside the required `fortuna` namespace;
  deferred flat functions are rejected by App Server. `thread/resume` cannot
  replace dynamic tools. Stream text from `item/agentMessage/delta`, interrupt a
  stopped request with `turn/interrupt`, and keep at most one active turn per
  user.
  Raise `COPILOT_TOOLSET_VERSION` whenever a tool is removed or renamed: a
  resumed thread cannot swap its tools, so old threads would keep offering
  the removed ones.
- Build a compact base snapshot and add only the domain context selected from
  the current question. Cache snapshots against the in-process user data
  revision and advance that revision after every session mutation or Copilot
  tool write. Keep browser history as recovery context for a new server thread,
  not as repeated context for every resumed turn.
- The Copilot persona is Herr Konrad Körner, a factual, precise accountant
  who writes plain standard German. No dialect, regional colour or irony (the
  owner's decision of 01.10.2026); both prompts say so and
  `tests/copilot.test.ts` holds it. There is no dedicated bookkeeping-audit shortcut;
  work on the bookings the owner actually asks about. Resolve obvious cases
  directly; for ambiguity ask exactly one question with the transaction
  reference, date, amount and original description. Apply the answer before
  moving to the next unclear item only when the owner requested a batch.
  Address the signed-in owner formally with `Sie` and their last name. Render
  model output through the shared safe GFM Markdown component; do not enable raw
  HTML. Keep retry from duplicating the user's visible message and keep chat
  visible chat history browser-local.
- Copilot attachments use the bounded same-origin multipart route. Store them
  only under the private temporary upload root, scope metadata to `userId`,
  never log names or contents, and delete successful uploads or expire them
  after 30 minutes. Images use App Server `localImage`; text is length-limited;
  PDFs use Poppler text extraction with at most four rendered scan pages.
- Durable Copilot memories hold only user-confirmed preferences, naming
  conventions and domain rules. Use a stable key so corrections replace old
  knowledge. Do not duplicate balances, transactions, contracts or credentials
  there, and expose the entries to the owner for inspection and deletion.
- A recurring payment getting more expensive is an observation, not a task:
  it belongs in Hr. Körner's engine, where it can be dismissed, snoozed or
  marked intentional. `previous_amount_minor` and `price_changed_at` persist
  what detection saw; the finding is keyed on that date so a later rise is a
  new finding and the same one is never reported twice.
- A contract missing a start date, a cost or a cadence never reaches the
  forecast. Where a recurring payment is linked, `proposeContractDetails`
  offers what the bookings know — proposed, never applied: a contract is a
  document, and a value read off the account is evidence about it.
- Hr. Körner's explicit numeric goals and alert thresholds live in
  `financial_profiles`, not free-form Copilot memories. The pure observation
  engine lives in `src/domain/hr-koerner.ts`; persisted findings are keyed per
  user so repeat reviews do not duplicate them. Keep dismissed and intentional
  decisions suppressed, honor snooze dates, and never interpret payments as
  proof of product usage or physical ownership. Monetary profile values carry
  their original currency; do not compare them after a base-currency change
  until the owner updates the profile. In-app review runs on authenticated
  visits and after imported bank or Scalable data, not as an unattended job.
  The reserve observation compares liquid cash with `requiredReserve`, not
  the bare minimum.
- Permanent contract documents are AES-256-GCM encrypted before they leave the
  application. Prefer the private S3-compatible object store when configured;
  retain the nullable encrypted PostgreSQL payload only as a development and
  migration fallback. Database metadata must never expose the storage key.

## Releases and language

- The user interface is German. Keep new page copy, form labels, feedback,
  accessibility text and default category names in German. Internal enum and
  API identifiers remain English.
- `package.json` is the source of truth for the app version. Every release adds
  the newest German entry to `CHANGELOG.md`; the version chip in the sidebar
  and on the login page opens these notes inside the app.
- Keep the first changelog version equal to `package.json`; the release-notes
  test enforces this. Use semantic versioning for release numbers.

## Lessons from the owner's real data (28.09.2026)

- Recurring detection runs after every import that brought new bookings
  (`detectRecurringAfterImport`), before auto-filing; it used to run only on
  a button nobody pressed. `manualPaymentFor` adopts the owner's hand-entered
  payment (links its bookings, follows its dates, never changes its fields)
  instead of creating a detected copy. A detected payment is deactivated on
  delete, never removed, or the next sync brings it back. A monthly payment
  with no due date falls due on its typical day (`fallbackNextExpected`),
  never today. Any grouping by merchant must use `namesCounterparty`: a
  placeholder text is never a merchant key.
- Before three full months the reserve basis is max(recurring outflows,
  average of the full months so far) (`"partial"`); recurring payments are a
  floor, not an estimate.
- An account counts in past net worth from its first booked transaction;
  wallets (PayPal) are the exception, because their ledger has no funding
  leg and rebuilding backwards invents a balance. `holdingsBreakdown` adds
  up to total assets, including the depot's reported remainder (crypto
  without positions). FX: the newer rate of a pair wins, whichever way round
  it was stored.
- A Sparmission without a direct contract link reads the contract through
  its recurring payment.
- A transfer-kind card-settlement category without a card account removes
  all card spending from cashflow, the forecast and the reserve. Say so when
  the numbers look implausibly good.

## Phone and touch

- `DialogContent` is the single scroll container (`p-5` / `max-sm:p-4`) and a
  bottom sheet below `sm`. Actions go in `DialogFooter`, which uses
  `-bottom-5`, not `bottom-0`, because a sticky inset counts from inside the
  scroll container's padding; the footer, not the sheet, pads the home
  indicator. A phone dialog puts its actions in a footer.
- Tap targets are 44 px via `pointer-coarse:`, never by window width.
  Fields are 16 px below `sm` (iOS zooms smaller ones). Amounts use
  `AmountInput` (decimal keypad; `type="number"` rejects the German comma),
  and a prefilled amount uses a decimal comma (`amountInputText`).
- The iOS keyboard never shrinks `100dvh`. Use `--app-vvh`,
  `--keyboard-inset` and `data-keyboard` from `useViewportVars`, and clear the
  phone bars with `--phone-header-h` and `--phone-tabbar-h`. The phone tab
  bar (Hr. Körner, Umsätze, Konten, Vermögen, Mehr) is part of the shell and
  holds still with `view-transition-name: nav-tabs`.
- `TableCell` labels and right-alignment on phones apply only inside
  `stacked` tables.
- Debts and asset rows are tap-first: a row opens an action sheet
  (`BalanceActionsDialog`, `AssetValueDialog`), never an inline edit, and
  every write is still a dated history row. "Vollständig beglichen" writes a
  zero balance; "Rate gezahlt" subtracts only the repayment part
  (`splitRate`); `balanceDateProblem` refuses a date before the latest
  observation. `/assets/$id?update=1` and `/debts?highlight=<id>` open the
  sheet directly; domain hrefs with a query are split into `to` and `search`.
- Choosing a category in the booking sheet saves at once through
  `transactionEditPatch`; recent categories live only in the browser
  (`fortuna.recent-categories`). Review picks are sent only for bookings still
  open (`openPicks`), or a stale pick overwrites a later decision.
- Order dialog on a phone: collapsed disclosure sections are a reading aid
  only; confirm requires every section opened and the end read, then the
  warning checkbox and `confirm()` as before.
- `bun run smoke` also fails a route that scrolls sideways at 390 px.
  better-auth rate-limits repeated logins (HTTP 429): browser scripts log in
  once and reuse the cookies.

## Traps

- `tests/route-imports.test.ts` walks every client route's value imports and
  fails on a reachable `node:` built-in, which is the one check `verify` could
  not make. Keep it passing; it prints the import chain that broke.
- A route file may only import domain modules that are free of Node built-ins.
  `src/domain/fingerprint.ts` holds the one `node:crypto` user; importing a
  module that reaches it kills the page in the browser with "Module node:crypto
  has been externalized", and only a browser visit catches it.
- `refreshRecurringOccurrences` may only clear `next_expected` on a detected
  row (one with a `match_key`). A manual row's date is the owner's input and
  there is nothing to re-derive it from; the forecast treats a missing date as
  today, so clearing it charges a yearly premium on day 0.
- An entry animation with `animation-fill-mode: both` (or `forwards`) holds
  its final keyframe for good, and held keyframe values beat any class or
  transition set later: the ring's `fortuna-ring-in … both` pinned
  `opacity: 1`, so the dissolve never showed. Use `backwards` for an entry
  animation on anything whose opacity or transform changes afterwards, and
  prove a fade with `getComputedStyle`, not with a screenshot.
- A flex item keeps `min-width: auto`, so a label beside a shrink-0 group
  overflows under its neighbour instead of wrapping. The donut legend did
  exactly that. Give the text `min-w-0`, and give the legend enough minimum
  width that it wraps under the ring rather than being squeezed beside it.
- Reading `event.currentTarget` inside a `setState` updater gets null: React
  has already recycled the event by the time the updater runs. Destructure the
  value first, then update.
- Recurring amounts are stored signed: an outflow is negative, and
  `createRecurring`/`updateRecurring` sign by `direction` whatever the caller
  sends. The Copilot and MCP tools pass magnitudes; before the service
  enforced this, three outflows created that way were forecast as income. Compare
  magnitudes in thresholds, and write test fixtures with the sign the database
  actually produces, or a feature can pass its tests while never firing.
- Month-based cadences are counted from the anchor date, never stepped from the
  previously clamped one, or a payment due on the 31st walks backwards.
- A provider's error message can contain its raw response body. Build messages
  with `safeProviderMessage` from `src/server/provider-errors.ts` and log only
  an error class and HTTP status — never the message, in a log, in
  `last_error` or in a response.
- Totals rendered as a single base-currency amount must filter to that currency
  first; rows in another currency show their own and stay out of the sum.
- `content-length` is absent on a chunked upload. Bound the body itself with
  `withBodyLimit` from `src/server/request-limits.ts`.
- Only `createAccount` seeds an opening balance observation; a provider sync
  inserts the account first, so `recomputeAccountBalance` has to tolerate an
  account that has none yet.
- The Vite dev server listens on `[::1]` only; the SSR oRPC client therefore
  uses `localhost` outside production and `127.0.0.1` in production.
- Copilot stream diagnostics use the browser-visible `Diagnose-ID` as `traceId`
  in structured logs. Compare `copilot.http.*`, `copilot.stream.*` and
  `copilot.turn.*` events to locate failures before the first queued chunk,
  during App Server work or after cancellation. Never log prompts, answers,
  attachment contents, provider responses or authentication material.
- The Copilot NDJSON stream queues a heartbeat immediately and every five
  seconds while a turn runs. The browser ignores it. Preserve this when
  changing the route: without an early chunk, the production connection was
  aborted after about ten seconds before the first model text.
- `vitest` does not read `.env`; the integration config loads it explicitly.
- Format timestamps through `formatDateTime` (fixed to Europe/Berlin). A
  zone-less `Intl.DateTimeFormat` renders UTC on the server and breaks
  hydration.
- Never collect values inside a `setState` updater and read them after the
  call: once another update is queued on the component, React runs the
  updater during the next render. Hr. Körner's proposed categories were
  always empty for that reason.
- An edit dialog sends only changed fields (`transactionEditPatch`). The
  server reads a sent `categoryId` as the owner's decision and marks it
  `manual`; a disabled select is missing from `FormData` and reads as null.
  Form dialogs send an empty field as `null`, not `undefined`, so a service
  default written as `=== undefined` never fires from the UI.
- Every error the Codex App Server returns may contain the provider's
  response. Show only Fortuna's own wording (`FAILED_TURN_MESSAGE`). Anything
  handed to the Copilot model, snapshot or tool result, goes through
  `withoutAccountIdentifiers`. `isolatedTurn` and `streamCopilot` claim the
  owner in `activeTurns` before their first await.
- Enable Banking CNCL and RJCT transactions are dropped at mapping; only BOOK
  is booked. A provider pending row is deleted only under
  `unreportedPendingIds` (`src/domain/pending.ts`), and the read reaches back
  to the oldest such row. Every bank sync, including the callback's first
  read, goes through `coalesceSync`.
- Recurring and contract forecast entries pass `typicalDay` and their real
  interval, or a date clamped to a short month becomes the anchor.
- A liability with `linked_account_id` has a stale `current_balance_minor`;
  read `owedMinor`/`owedAsOf` from `listLiabilities`. An inactive liability
  ends by today whatever its `end_date` says.
- Hr. Körner's price-increase findings are for outflows only, and every
  monetary profile value is ignored while `profile.currency` differs from the
  base currency.
- Drizzle's `and()` does not parenthesise a raw `sql` fragment, so an `or`
  inside one escapes every other filter: the booking-text refresh rewrote
  every placeholder booking in the table from 19.09.2026 until 0.52.3. Build
  alternatives with `or()`, never as ORs in raw SQL. Rows it damaged are repaired
  by the sync: every owner or Copilot edit goes through `updateTransaction`,
  which recomputes the fingerprint, so a text that no longer matches its
  fingerprint (`textAlteredBehindFingerprint`) was changed by a raw update.
  `insertTransactions` restores the bank's text, merchant and counterparty on
  such a row when the bank sends it again, and the Enable Banking read reaches
  back to the oldest one (`alteredTextSince`, at most 89 days). Any future raw
  update of `description` must recompute the fingerprint too, or the next
  sync will treat it as damage.
- `insertTransactions` turns a pending row into a booking when its booked
  version arrives as a duplicate; automatic transfer pairing pairs booked rows
  only. The Enable Banking read starts from the newest booked, non-manual row
  minus 7 days (`transactionReadFrom`); a pending or hand-entered row must
  never set that start.
- In a Drizzle select from a single table, `${table.column}` inside a
  correlated `sql` subquery renders as a bare `"id"`, which binds to the inner
  table and silently matches nothing. Qualify the outer column by name, e.g.
  `"recurring_payments"."id"`.
- Agent worktrees under `.claude/worktrees/` carry their own `biome.json`, and
  `bun run check` from the repo root then fails on nested root configs. Run
  `bunx biome check src tests scripts` while they exist.
- Drizzle runs every pending migration in ONE transaction, so a migration can
  never use an enum value another migration just added — Postgres answers
  "unsafe use of new value", and splitting it across two files does not help.
  Writes that need a fresh enum value go in `repairAfterMigrations` in
  `src/server/db/migrate.ts`, which runs after the migrator commits and must
  stay idempotent.
  The same rule breaks a brand-new database: an early migration uses a
  `connection_status` value added in the same run, so `db:migrate` and
  `db:reset` fail on an empty database. Production migrates incrementally and
  is unaffected. For a fresh local database, run `bun run db:bootstrap:local`
  then `bun run db:migrate`. Bootstrap commits each unchanged file separately,
  checks the ledger on resume, and refuses remote or production targets.
  Demo seeding is limited to local `fortuna_dev`, `fortuna_test`, and
  `fortuna_demo_*` names; never import owner data for public screenshots.
  The README screenshots use `bun run db:seed:preview` in an empty local
  `fortuna_demo_*` database and reconcile to EUR 65,000. Capture the real pages
  with `bun run screenshots` (it refuses any other database), never edit
  displayed totals. In that seed, a booking dated on an account's opening
  date does not move its balance, and a transfer leg seeded with a category
  counts as the owner's decision and is never paired. Reproduction is in `docs/screenshot-preview.md`.
- `bank_transaction_code.description` is sometimes prose and sometimes the bare
  ISO domain code: the Sparda answers "PMNT". Never show a four-capital code as
  a booking text — it makes the row unfilable by the owner and by Hr. Körner.
- Adding a required column to a populated table needs add nullable, backfill,
  `SET NOT NULL`; a bare `NOT NULL` add aborts the preDeploy migration.
- better-auth 1.7.4 has no `issuer` column on `account`; do not add one from
  older examples.
- Do not commit `@better-auth/cli generate` output unreviewed; it rewrites
  `auth-schema.ts` wholesale.

## Quality bar

- Conventional Commits; explain why, not what.
- UI copy is short German. Amounts use `Money`/`useFormat`, never ad-hoc
  formatting, and a real minus sign.
- A caveat is stated once, in the least prominent place that still answers
  the question — never in a hero panel, a page-header subtitle, a KPI tile or
  a status chip. "Noch kein Vergleichswert" is a label; the sentence about
  why belongs in the Datenstand card or beside the one table it concerns.
  "CLI", "Snapshot", "Token", "Sitzung" and product names stay out of
  headlines and chips (an institution's name on its own account or depot
  page is not a headline). No screen uses dialect. A label map falls back to "—", never to the raw enum.
- The navigation rail and every hero panel are dark navy in both themes; only
  `bg`/`surface` flip with the theme. A subtree drawn on them carries the
  `on-navy` utility, which re-points the semantic colour tokens at their navy
  equivalents, so an existing component keeps its contrast there without an
  "on dark" variant. Reach for `on-navy` before hand-picking a colour.
- Glow and gradient belong to those always-dark surfaces. A page card, a
  table or a chart stays flat; `shadow-glow` on a button hover is the one
  exception.
- `HeroRing` takes a ratio the product actually computed, shown with its name
  beside the ring — the dashboard fills it with the equity ratio (net worth
  over total assets). A partly filled ring reads as a measurement, so it must
  never be filled for decoration. It is a gauge of 90 ticks: the dot runs a
  lap and each tick flares as it passes, then it settles and the ticks inside
  the ratio stay lit. After the hold only the solid arc fades; ticks, dot and
  rim rest on screen with the ratio still readable. Hover brings the arc
  back, a tap replays. Tick timing is derived from the marker's easing
  (`bezierTimeAt`), so keep the two keyframe sets and the constants in step.
  Under reduced motion the rest timer is never armed and
  `animation-delay: 0s` makes every delayed step land at once, so the ring is
  simply drawn lit — the global reduced-motion rule collapses animations but
  must not hide content.
- Page changes crossfade through `defaultViewTransition` on the router. The
  rail and the phone header carry their own `view-transition-name`, so they
  hold still while the page beside them changes.
- `--radius-md` (12px) is the card radius and `--radius-control` (8px) the
  radius for buttons, inputs and selects. A control that takes `rounded-md`
  reads as a pill at h-8.
- A light red goes pink on the navy. Dark-theme and `on-navy` negatives are a
  warm red (`#FF6152`), never a salmon tint.
- Visible user content wraps instead of using `truncate`. Wide tables own an
  `overflow-x-auto` container, and date inputs keep enough inline width for
  Safari's localized value and picker control.
- The dashboard and recap explain outdated financial data with the affected
  item's name and age: missing dates or values older than 30 days need an
  update. Do not replace this with an unexplained composite percentage. The
  holdings Sankey uses wrapped labels and bounded label gutters so long names
  cannot squeeze the flow columns.
- Chart axis ticks must stay inside the plotted domain and SVG bounds. Keep
  bottom padding for date labels so chart text cannot bleed into a following
  caption or neighboring card; tooltips must fit narrow cards.
- Before calling a change complete run `bun run verify` and exercise the
  affected page in the browser. `verify` does not load a page, so a broken
  client import passes every check and still breaks the route.
- `bun run smoke` loads every authenticated route in a headless browser
  against a running `bun run dev` and fails on an error boundary, an uncaught
  error or a 5xx. Run it after touching routes or the router. It needs
  `OWNER_EMAIL`/`OWNER_PASSWORD` from `.env` and Chromium
  (`bunx playwright install chromium`). Where a Chromium is preinstalled that
  does not match the Playwright version, point
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE` at it (e.g. `/opt/pw-browsers/chromium`).
- A clickable table row uses `TableRow`'s `onActivate`, which adds focus and
  Enter/Space; a destructive action asks with `confirm()` first.
