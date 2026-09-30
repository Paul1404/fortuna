ALTER TABLE "accounts" ADD COLUMN "provider_account_ref" text;--> statement-breakpoint
-- Existing accounts were matched by IBAN, so that is their stable reference.
-- Backfilling keeps a renewed consent recognising them through the new path
-- instead of creating duplicates on the next renewal.
UPDATE "accounts"
SET "provider_account_ref" = upper(replace("iban", ' ', ''))
WHERE "iban" IS NOT NULL AND "provider_account_ref" IS NULL;
