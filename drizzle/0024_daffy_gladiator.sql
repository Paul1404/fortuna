ALTER TABLE "bank_connections" ADD COLUMN "automatic_retry_at" timestamp with time zone;--> statement-breakpoint
UPDATE "bank_connections"
SET "automatic_retry_at" = "updated_at" + interval '6 hours',
    "last_error" = 'Banklimit erreicht (HTTP 429).'
WHERE "provider" = 'enable-banking'
  AND "status" = 'error'
  AND ("last_error" LIKE '%ACCESS_EXCEEDED%' OR "last_error" LIKE '%ASPSP_RATE_LIMIT_EXCEEDED%');
