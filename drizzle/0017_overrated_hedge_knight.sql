CREATE TABLE "investment_source_accounts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"source_account_id" text NOT NULL,
	"status" "connection_status" DEFAULT 'pending' NOT NULL,
	"currency" text NOT NULL,
	"cash_balance_minor" bigint,
	"last_successful_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investment_source_positions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"instrument_name" text NOT NULL,
	"isin" text NOT NULL,
	"wkn" text,
	"ticker" text,
	"asset_class" text,
	"quantity" numeric(20, 8) NOT NULL,
	"cost_basis_minor" bigint,
	"value_minor" bigint,
	"currency" text NOT NULL,
	"valuation_at" timestamp with time zone,
	"verification" text DEFAULT 'inferred' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investment_source_transactions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"source_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"instrument_name" text,
	"isin" text,
	"quantity" numeric(20, 8),
	"unit_price" numeric(20, 8),
	"amount_minor" bigint NOT NULL,
	"fee_minor" bigint,
	"tax_minor" bigint,
	"currency" text NOT NULL,
	"encrypted_raw_metadata" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investment_sync_runs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"mode" text NOT NULL,
	"status" "import_status" NOT NULL,
	"imported" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_code" text
);
--> statement-breakpoint
ALTER TABLE "investment_source_accounts" ADD CONSTRAINT "investment_source_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_source_positions" ADD CONSTRAINT "investment_source_positions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_source_positions" ADD CONSTRAINT "investment_source_positions_account_id_investment_source_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."investment_source_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_source_transactions" ADD CONSTRAINT "investment_source_transactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_source_transactions" ADD CONSTRAINT "investment_source_transactions_account_id_investment_source_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."investment_source_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_sync_runs" ADD CONSTRAINT "investment_sync_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_sync_runs" ADD CONSTRAINT "investment_sync_runs_account_id_investment_source_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."investment_source_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "investment_source_account_unique" ON "investment_source_accounts" USING btree ("user_id","provider","source_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_source_position_unique" ON "investment_source_positions" USING btree ("account_id","isin");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_source_tx_unique" ON "investment_source_transactions" USING btree ("account_id","source_id");--> statement-breakpoint
CREATE INDEX "investment_source_tx_user_date" ON "investment_source_transactions" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "investment_sync_runs_account_idx" ON "investment_sync_runs" USING btree ("account_id","observed_at");