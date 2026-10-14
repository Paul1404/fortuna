ALTER TABLE "receivables" ADD COLUMN "source_transaction_id" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "bank_details" jsonb;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_source_transaction_id_transactions_id_fk" FOREIGN KEY ("source_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "receivables_source_transaction_idx" ON "receivables" USING btree ("source_transaction_id");