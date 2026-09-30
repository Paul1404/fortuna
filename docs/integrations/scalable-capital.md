# Scalable Capital: official interface research

Research checked on 17 September 2026. Fortuna 0.18.2 adds an in-app
device-code connection through the official CLI while Scalable's hosted MCP
web-client allowlist remains closed to Fortuna.

## Near-live market pulse in Fortuna 0.20.0

The dashboard uses one fixed official `broker holdings --json` CLI read at most
once per minute while the authenticated page is visible. An in-process cache
coalesces concurrent requests and errors back off for five minutes. Scalable
does not document a streaming quote feed or public polling limit for this CLI,
so this is a bounded near-live read, **not** a real-time exchange feed.
The Scalable session and signing key remain encrypted and are materialized only
inside the existing private CLI workspace. This route requires a browser session;
Fortuna's read-only MCP cannot initiate provider reads or financial mutations.

Only fresh quotes for unchanged quantities with a known, priced baseline
contribute to the *indicative* net-worth overlay. Missing, outdated or
non-convertible quotes, a trade since the last full sync, and FIFO-cost-only
baselines are skipped by the pulse. Crypto stays at the last
confirmed aggregate because the CLI holdings read does not provide individual
crypto positions. The booked net-worth value and its history are never written
by the pulse. The top per-ISIN differences are measured against the latest
confirmed Scalable snapshot, not yesterday's closing price. These attribution
values are available internally but are no longer shown on the dashboard.

Since 0.20.1, the browser uses a quote overlay only while its confirmed
baseline exactly matches the latest dashboard snapshot. A concurrent full
broker sync invalidates the old overlay before a new quote comparison.

Since 0.20.2, the dashboard has its original uncluttered net-worth card. The
large number counts up on page load with Fortuna's existing `Money animate`
behavior. At least two seconds after mount, a fresh comparable Scalable quote
can update that same number with the **same 850 ms animation**, upward or
downward. Later observed changes use the same animation. There is no continuous
invented drift between actual reads. Reduced motion still resolves immediately.
The confirmed balance sheet and net-worth history are unchanged; the pulsing
number is an indicative display only. Detailed provider status, source and
timestamps remain in the Scalable connection and investment views, not as
additional dashboard labels or cards.

The goal calculation uses only an owner-configured net-worth target and monthly
savings rate. Months and the market-related day shift are linear estimates,
not performance forecasts. They are no longer shown next to the dashboard
number. A separate daily close observation is saved only
on a signed-in visit after 22:15 Europe/Berlin with a fresh, complete Scalable
quote. If Fortuna is closed, the provider has no current price, or data is
incomplete, there is no daily close for that date. There is no unattended
scheduler or retroactive filling. The daily close and its comparison remain
internal data in this release, not a dashboard card; a future dedicated report
can expose them. A whole net-worth difference can include deposits, debt
changes and other assets, so it must not be labeled a pure market return.

Scalable's [official MCP tool list](https://help.scalable.capital/en/agentic-investing-aac939f8/what-can-my-ai-assistant-do-with-the-scalable-mcp-28d8129c) exposes portfolio discovery and overview, holdings, cash breakdown, performance, transactions and transaction details. Its security search and quote tools expose instrument metadata and prices. The same MCP also exposes buy/sell previews, submissions and cancellation, plus mutable savings-plan, watchlist and alert tools. Buy/sell submission requires a fresh explicit confirmation, but Fortuna must not expose those tools to its Copilot or read-only MCP.

Scalable's [official setup guide](https://help.scalable.capital/en/agentic-investing-aac939f8/how-do-i-connect-to-scalable-mcp-75fc6a40) requires enabling Agentic Investing on the Scalable website, then browser sign-in, 2FA and consent in a compatible MCP client. A live unauthenticated challenge from `https://mcp.scalable.capital/mcp` pointed to the official protected-resource metadata. That metadata names `https://mcp.scalable.capital/` as the authorization server. Its public `/.well-known/oauth-authorization-server` document advertises authorization code, S256 PKCE, dynamic client registration at `/register`, public-client token authentication at `/token`, and refresh tokens. Advertised scopes are `openid`, `profile`, `offline_access`; no dedicated read-only scope appears. However, an actual registration request for Fortuna's exact production callback returned `invalid_redirect_uri`: **“Web clients may only register exact redirect URIs from the approved SaaS allowlist.”** This provider-side rule blocks a direct Fortuna web OAuth connection until Scalable allowlists `https://fortuna.pdcd.net/api/integrations/scalable/callback`. We must not reuse another product's client ID or circumvent that rule. Refresh is advertised, but unattended lifetime/reliability cannot be tested before registration and owner consent.

The [official Scalable CLI](https://github.com/ScalableCapital/scalable-cli) exposes `broker overview`, `holdings`, `cash-breakdown`, `analytics`, paginated transactions and transaction details, quote/search, and overnight-account summaries/transactions as JSON. Its OAuth device-code login remains human-oriented. Session storage supports keyring or file; signing keys support file, macOS Secure Enclave, or Linux PKCS#11. The `--local-read-only` guard does **not** reduce token permissions. The official source projects holdings as ISIN, name, quantity, FIFO price, valuation, valuation currency, quote price and timestamp, and cash breakdown as cash balance distinct from buying power and credit. This is enough for a priced broker snapshot through official CLI commands. The CLI runs on a Scalable API, but that is not a published REST contract for Fortuna. Since direct web MCP registration is blocked, the server-hosted official CLI is the supported near-live path, not a reason to use private endpoints.

The [official CSV export guide](https://help.scalable.capital/de-AT/kontoverwaltung-f3197dc7/wie-kann-ich-meine-transaktionen-einsehen-und-exportiere-95b9911b) confirms full or filtered transaction export, but does not publish a stable column schema or a holdings snapshot format. CSV remains bootstrap/recovery input. The broker's exact MCP response fields, pagination, rate limits and token lifetime are not specified in these public documents and must be validated with an authorized account before they are claimed as working. Precise WKN/ticker/cost-basis availability from MCP, non-Broker products such as Wealth/Credit, and a dedicated read-only OAuth scope remain unconfirmed.

## Implementation and verification

### What Fortuna implements
Fortuna packages Scalable's signed official CLI v1.1.0 (since 0.52.0) in its glibc-based
runtime image. The build verifies Scalable's minisign checksum manifest and a
pinned SHA-256 digest. **Mit Scalable verbinden** in Fortuna starts the CLI's
official device-code login. The owner opens the Scalable URL and personally
approves login and 2FA. Fortuna never receives the password or 2FA code. After
approval, the full-permission CLI session and DPoP signing key are stored
AES-GCM encrypted in `external_connections`. That is a meaningful server-side
credential risk despite Fortuna's own read-only command allowlist. The CLI's
`--local-read-only` flag and `allowed_isins = []` config are defense in depth,
not server-enforced token scopes. A compromised server could still misuse the
credential, so the Scalable account's Agentic Investing authorization should
be reviewed and revoked there if Fortuna is compromised.

Every invocation materializes the encrypted CLI files only in a private
`/dev/shm` workspace, uses a scrubbed child environment and fixed argv, and
deletes that workspace afterward. The app invokes only `broker overview`,
`holdings`, `cash-breakdown`, and cursor-paginated `transactions` with `--json`.
CLI JSON has an outer `{ok, command, data}` envelope; Fortuna unwraps and
validates `data` before ingestion. The refreshed session is re-encrypted after
each successful read. The authenticated app checks for a due sync after 15
minutes; failed automatic attempts back off for an hour. **Jetzt abgleichen**
remains available. Neither the Copilot nor Fortuna's read-only MCP can invoke
these mutation routes or any trading command. Disconnect attempts the official
CLI logout and always removes the local encrypted session, while retaining
the last portfolio valuation as visibly stale data.

The owner-operated `scripts/scalable-sync.ts` relay and its ingest endpoint
were removed in 0.20.6. They duplicated the hosted device-code flow above with
a second disconnect button and a manual scheduling step, and migration 0029
deletes the stored relay token hashes.

Both CLI methods use the existing provider-neutral investment-source tables.
Snapshot replacement is transactional. Source transaction IDs are unique per
account and carry a content fingerprint; repeats are no-ops. Since 0.20.3,
same-ID corrections with an unchanged kind, ISIN and currency replace the
visible transaction after archiving its previous encrypted version. An
ambiguous reused ID is held back and shown as a warning; holdings and cash can
still refresh. This is a guarded recovery from mutable provider summaries, not
evidence that Scalable formally guarantees a particular revision lifecycle.
Raw provider responses are AES-GCM encrypted in PostgreSQL
and are never returned by list queries or MCP. Failed syncs retain the last
accepted values and show a sanitized error. No generic remote MCP tool proxy
is present.

### Valuation and net worth

Scalable holdings with a monetary value count as investments. Scalable broker `cash_balance` counts as cash; *buying power* and *available credit* do not. The official CLI portfolio valuation is authoritative for the account-level securities total when present, while item valuations provide drill-down. Differences between account total and visible holding values are shown instead of being silently hidden. A direct provider valuation is `provider_reported`; a price multiplied by quantity or a FIFO-cost fallback is `estimated`. Values older than 30 days or without a trusted timestamp show `stale`, but remain in net worth. A quantity without provider value, quote or known cost stays visible as `unavailable` and contributes no invented amount.

CSV upload was removed in 0.20.6; its parser had never been run against a real owner export. Source rows imported by earlier versions keep `method = 'csv'` and stay readable, and a valued CLI snapshot still takes precedence over them. Scalable positions and cash appear in the normal investment/net-worth views and in the read-only MCP results. If the owner explicitly links an existing Fortuna account to a source account, that manual account is suppressed to avoid double counting. No Scalable account was reported as manually represented when this release was built.

The selected source portfolio also appears under **Konten → Depots** as a linked broker view, not as an additional row in Fortuna's bank-account balance table. Its detail page lists all current holdings with identifiers, quantity, price, cost where available, valuation source and timestamp. Broker transactions have a separate paginated list with type, time, amount, quantity, fees and taxes where supplied. Scalable's official overview can include an aggregate crypto valuation even when `broker holdings` has no individual crypto rows. Fortuna stores and shows that separately, already inside the reported depot total, without inventing coin-level holdings or adding it a second time. An unexplained residual beyond listed holdings and the reported crypto aggregate remains visible as a discrepancy. An unavailable provider field stays unavailable rather than becoming zero or a guessed amount.

Current provider snapshots are point-in-time observations, not a historical price series. Fortuna counts them in current net worth, but does not back-cast today's broker value into prior monthly snapshots. Historical Scalable valuation history would need repeated snapshots stored as dated observations. Currency conversion still follows Fortuna's FX rules; unconvertible currencies are reported, not summed as EUR.

### Provider limits

Earlier releases shipped a CSV transaction parser built from the observed
`date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency`
shape. No real owner export was ever supplied to test it, so 0.20.6 removed the
parser and the upload route rather than keep an unverified import path.

Scalable's MCP would be the preferred hosted interface, but the provider's
registration endpoint rejects Fortuna's production callback unless it is
added to Scalable's SaaS allowlist. No direct hosted MCP sync is implemented
or claimed. Public rate limits are not documented in the cited materials;
the hosted CLI reader caps each call and pagination, and avoids aggressive
polling. A real owner-authorized login and readback are required before the
new hosted path may be called authenticated or automatic in production.

To unlock hosted MCP later, request approval from Scalable for the exact redirect
URI `https://fortuna.pdcd.net/api/integrations/scalable/callback`. Do not use a
different app's client ID or a loopback/native redirect to evade the web-client
allowlist. After approval, implement and test the same small read-tool allowlist
with owner-controlled PKCE login and encrypted refresh tokens.

Since 0.50.0 the investment plan offers capital advice on free broker cash and
a periodic depot review. The official CLI's two-step trade flow (`sc broker
trade buy|sell` returns a preview and a confirmation ID; only a repeat with
`--confirm` places the order) would map onto that approval, but Fortuna does
not use it: an approved decision is stored as an order ticket the owner places
in Scalable, then marks as placed or dropped. Executing through the CLI would
need its own review of the credential risk described above.

Trading remains out of scope. The official MCP/CLI order preparation and explicit confirmation model is documented above, but no order creation, modification, cancellation, withdrawal or transfer is reachable from Fortuna's browser API, Copilot tools or read-only MCP.

## Orders (since 0.58.0)

By the owner's decision of 26.09.2026, Fortuna can place an order at Scalable
that the owner confirms, with no amount limit. Trading needs a second device
login under Verbindungen → Scalable → **Handel freischalten**, made without
`--local-read-only`; reads keep the read-only login. An order is only possible
for an instrument already in the depot, as a market order (buy by amount, sell
by shares, never more than held), and follows the CLI's two-phase flow:

1. Phase 1 (`sc broker trade buy|sell … --json`) runs in a workspace whose
   `[trade_controls]` allow exactly that ISIN and, for a buy, the confirmed
   amount plus 1 %. Fortuna shows every field the CLI requires
   (`pre_trade_full_disclosure_v1`) unchanged.
2. Phase 2 repeats the identical arguments with `--confirm <id>` only after
   the owner presses the order button and confirms the prompt; a required
   appropriateness warning must be acknowledged first.

Every preview and submission is logged in `broker_orders` (encrypted preview
and result, safe error codes only) and shown as **Orderprotokoll** on the
Anlegen page. The Copilot and MCP cannot reach any of it. **Handel sperren**
logs the trading session out at Scalable.
