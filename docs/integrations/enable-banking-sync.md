# Enable Banking sync failures and limits

Fortuna reads account details, balances and transactions through Enable Banking.
It never initiates payments. A successful bank balance stays available after a
later read fails; no failed fetch is interpreted as a zero balance.

On 17 September 2026 the production connection received HTTP 429 on three
attempts close together. The old six-hour delay applied to automatic retries
only; the manual button could make more provider requests during that delay.
Enable Banking's [official FAQ](https://enablebanking.com/docs/faq/) says that
429 commonly reflects an ASPSP background-fetch limit and recommends retrying
after six hours. The live logs did not retain the response code inside the
provider body, so the precise upstream reason for this instance is not proven.

Since Fortuna 0.20.3, both automatic and manual syncs honor the stored
`automatic_retry_at` after a 429. The connection page shows the earliest retry
time and disables the button until then. A direct authenticated call during the
cooldown returns a sanitized rate-limit error without contacting Enable
Banking. Successful reads clear the cooldown. The response body is never
logged or returned; diagnostics retain only HTTP status, a small allowlist of
provider codes and the operation class (`account_details`, `balances`, or
`transactions`). A non-429 error keeps the previous bank balances and uses a
generic user-facing message.

If 429 persists after the cooldown, inspect Enable Banking's control-panel
request log or ask the bank about its PSD2 background access allowance. Do not
work around bank limits by rotating credentials or triggering repeated manual
requests.
