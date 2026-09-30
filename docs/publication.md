# Publication boundary

This repository starts from a reviewed source snapshot with fresh Git history.
Earlier history remains in a private archive. Never merge its branches here.
Public source does not mean public finances, open registration, or a hosted
service for others. Bank data, documents, broker sessions, authentication,
storage, and runtime configuration remain private.

Fortuna remains all-rights-reserved with `UNLICENSED` package metadata, not MIT
or another open-source license. Third-party components retain their licenses.
Owner-specific names in fixtures and maintenance notes are replaced with
fictional examples. The demo is synthetic, not an export of personal finances.

## Actual capabilities

Bank access imports information without initiating bank payments. Separately
authorized Scalable trading can submit real orders after a provider preview
and explicit owner confirmation. Trading is session-only, never a Copilot or
MCP tool. Do not describe the entire application as read-only.

MCP defaults to read-only. Named write tokens expose only the reviewed
domain-record allowlist. They cannot run every browser mutation, access provider
credentials, invoke Copilot, or trade. Signup stays disabled; accounts are
provisioned out-of-band. Preserve the stable `BETTER_AUTH_SECRET`, database,
and object storage when switching repository source.

## Setup and data

Historical migration files remain byte-identical. `db:bootstrap:local` commits
each file separately to make PostgreSQL enum additions usable by later files.
It validates the ledger prefix on resume, refuses a populated database without
a ledger, and accepts only localhost development/demo database names outside
production. `db:migrate` remains the unchanged production migration path.

`db:seed` is limited to the same local boundary and replaces the demo owner's
data. Use only disposable databases and fictional identities. Never copy a
production `.env` or connect a real bank/broker for screenshots.

The `fortuna-brand/mockups` assets are old design concepts, not current app
screenshots. Review every public image and fixture. Keep backups, provider
responses, private configuration, and agent workspaces outside Git. This review
and the test suite are not a penetration test or a guarantee against defects.
