# Fictional EUR 65,000 preview

The README screenshots use the current application at 1440 x 900 and, for the
phone, 390 x 844, both at twice the pixel density, with reduced motion and a
disposable local PostgreSQL database. They are not edited mockups,
production captures, or statements about the author's finances.

The scenario reconciles to:

- Cash: EUR 19,500.
- Investments: EUR 35,500.
- Physical assets: EUR 15,600.
- Liabilities: EUR 5,600, including a EUR 600 credit-card balance.
- Net worth: EUR 65,000.

`scripts/seed-preview.ts` supplies twelve full months of fictional income,
expenses, transfers, investment balance observations, asset valuations, and
loan repayments. The year is generated from a fixed seed: invented merchants,
fixed monthly payments, everyday spending that varies, a raise, a tax refund, a
holiday and a depot that also falls. The current account's opening balance is
derived from what was booked, so the closing balances above hold however the
year is changed. It uses the normal domain services and asserts the resulting
net worth exactly, in integer cents. No account identifiers, documents, or
provider credentials are copied from production.

Create an isolated local database named `fortuna_demo_<suffix>`. Set its
`DATABASE_URL`, local `BETTER_AUTH_SECRET`, local `BETTER_AUTH_URL`, and fictional
`OWNER_EMAIL`, `OWNER_PASSWORD`, and `OWNER_NAME`, then run:

```sh
bun run db:bootstrap:local
bun run db:seed:preview
bun run dev
```

The preview seed refuses remote hosts, production mode, non-demo database names,
and existing accounts, assets, debts, or external connections. It never clears
existing records. Use a disposable database, never a production `.env`, and do
not connect a real bank or broker. If an interrupted seed left partial data,
create another empty demo database instead of disabling the guard.

With the dev server running against that database, capture the images:

```sh
bun run screenshots
```

`scripts/capture-screenshots.ts` signs in as the fictional owner once and writes
the desk (light and dark), net worth, cashflow, fixed costs and two phone views
to `docs/screenshots`. It refuses any database that is not a local
`fortuna_demo_*` one. Check that the views show EUR 65,000 and that the assets,
liabilities, and history remain consistent. The old brand mockups are unrelated
to this scenario and are not used as product screenshots.
