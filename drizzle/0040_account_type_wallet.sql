-- Added on its own: Postgres allows a new enum value inside a transaction but
-- refuses to let the same transaction use it, so the account that needs it is
-- updated by the next migration.
ALTER TYPE "public"."account_type" ADD VALUE IF NOT EXISTS 'wallet';
