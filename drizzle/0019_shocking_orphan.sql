ALTER TABLE "investment_source_accounts" ADD COLUMN "method" text DEFAULT 'csv' NOT NULL;--> statement-breakpoint
ALTER TABLE "investment_source_accounts" ADD COLUMN "linked_account_id" text;--> statement-breakpoint
ALTER TABLE "investment_source_accounts" ADD COLUMN "cash_valuation_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "investment_source_accounts" ADD COLUMN "portfolio_value_minor" bigint;--> statement-breakpoint
ALTER TABLE "investment_source_accounts" ADD COLUMN "portfolio_valuation_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "investment_source_accounts" ADD COLUMN "last_attempted_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "investment_source_accounts" ADD COLUMN "capabilities" jsonb;--> statement-breakpoint
ALTER TABLE "investment_source_accounts" ADD COLUMN "encrypted_raw_metadata" text;--> statement-breakpoint
ALTER TABLE "investment_source_positions" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "investment_source_positions" ADD COLUMN "price" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "investment_source_positions" ADD COLUMN "valuation_source" text;--> statement-breakpoint
ALTER TABLE "investment_source_positions" ADD COLUMN "encrypted_raw_metadata" text;--> statement-breakpoint
ALTER TABLE "investment_source_accounts" ADD CONSTRAINT "investment_source_accounts_linked_account_id_accounts_id_fk" FOREIGN KEY ("linked_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
UPDATE "investment_source_positions" p
SET "value_minor" = p."cost_basis_minor",
    "valuation_at" = COALESCE(p."valuation_at", (
      SELECT max(t."occurred_at") FROM "investment_source_transactions" t
      WHERE t."account_id" = p."account_id" AND t."isin" = p."isin"
    )),
    "valuation_source" = 'csv_acquisition_cost'
WHERE p."verification" = 'inferred' AND p."value_minor" IS NULL AND p."cost_basis_minor" IS NOT NULL;
--> statement-breakpoint
UPDATE "investment_source_accounts"
SET "last_attempted_sync_at" = "last_successful_sync_at",
    "capabilities" = '["transactions", "estimated_positions"]'::jsonb
WHERE "method" = 'csv';
