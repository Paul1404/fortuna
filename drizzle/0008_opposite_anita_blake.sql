CREATE TABLE "receivable_balances" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receivable_id" text NOT NULL,
	"date" date NOT NULL,
	"balance_minor" bigint NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receivables" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"debtor_name" text NOT NULL,
	"currency" text NOT NULL,
	"original_amount_minor" bigint,
	"current_balance_minor" bigint DEFAULT 0 NOT NULL,
	"balance_as_of" date,
	"interest_rate_bps" integer,
	"monthly_payment_minor" bigint,
	"start_date" date,
	"due_date" date,
	"section" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"settled_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "receivable_balances" ADD CONSTRAINT "receivable_balances_receivable_id_receivables_id_fk" FOREIGN KEY ("receivable_id") REFERENCES "public"."receivables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "receivable_balances_receivable_date" ON "receivable_balances" USING btree ("receivable_id","date");--> statement-breakpoint
CREATE INDEX "receivables_user_idx" ON "receivables" USING btree ("user_id","is_active");