ALTER TABLE "financial_observations" ADD COLUMN "read_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "financial_observations"
SET "status" = 'resolved', "resolved_at" = now(), "updated_at" = now()
WHERE "type" = 'stale_asset_valuation' AND "status" IN ('open', 'snoozed');
