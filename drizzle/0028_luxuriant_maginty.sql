CREATE TABLE "investment_source_transaction_revisions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"previous_fingerprint" text NOT NULL,
	"previous_occurred_at" timestamp with time zone NOT NULL,
	"previous_status" text NOT NULL,
	"previous_amount_minor" bigint NOT NULL,
	"encrypted_raw_metadata" text NOT NULL,
	"revised_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "investment_source_transaction_revisions" ADD CONSTRAINT "investment_source_transaction_revisions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_source_transaction_revisions" ADD CONSTRAINT "investment_source_transaction_revisions_transaction_id_investment_source_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."investment_source_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investment_source_transaction_revisions_tx_idx" ON "investment_source_transaction_revisions" USING btree ("transaction_id","revised_at");