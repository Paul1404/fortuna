-- The transaction search uses ILIKE '%text%', which no btree can serve, so it
-- scans every row of the table. A trigram index makes that pattern indexable.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_description_trgm"
  ON "transactions" USING gin ("description" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_merchant_name_trgm"
  ON "transactions" USING gin ("merchant_name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_counterparty_name_trgm"
  ON "transactions" USING gin ("counterparty_name" gin_trgm_ops);
