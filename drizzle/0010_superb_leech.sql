CREATE TYPE "public"."contract_category" AS ENUM('insurance', 'utilities', 'telecom', 'subscription', 'banking', 'housing', 'mobility', 'other');--> statement-breakpoint
CREATE TYPE "public"."contract_document_type" AS ENUM('contract', 'policy', 'invoice', 'terms', 'cancellation', 'other');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('active', 'cancelled', 'ended');--> statement-breakpoint
CREATE TYPE "public"."scenario_rule_type" AS ENUM('growth', 'recurring_income', 'recurring_expense', 'one_time_income', 'one_time_expense', 'debt_repayment');--> statement-breakpoint
CREATE TYPE "public"."scenario_target" AS ENUM('cash', 'investments', 'physical', 'receivables', 'liabilities');--> statement-breakpoint
CREATE TABLE "contract_documents" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" text NOT NULL,
	"type" "contract_document_type" DEFAULT 'other' NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"encrypted_content" text NOT NULL,
	"extracted_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" text,
	"contract_number" text,
	"category" "contract_category" DEFAULT 'other' NOT NULL,
	"status" "contract_status" DEFAULT 'active' NOT NULL,
	"cost_minor" bigint,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"frequency" "frequency",
	"start_date" date,
	"end_date" date,
	"cancellation_date" date,
	"renewal_date" date,
	"notice_period_days" integer,
	"account_id" text,
	"recurring_payment_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_rules" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "scenario_rule_type" NOT NULL,
	"target" "scenario_target",
	"amount_minor" bigint,
	"annual_rate_bps" integer,
	"frequency" "frequency",
	"start_date" date,
	"end_date" date,
	"event_date" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenarios" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"horizon_years" integer DEFAULT 10 NOT NULL,
	"inflation_bps" integer DEFAULT 200 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_recurring_payment_id_recurring_payments_id_fk" FOREIGN KEY ("recurring_payment_id") REFERENCES "public"."recurring_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_rules" ADD CONSTRAINT "scenario_rules_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_documents_contract_idx" ON "contract_documents" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "contracts_user_idx" ON "contracts" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "scenario_rules_scenario_idx" ON "scenario_rules" USING btree ("scenario_id");--> statement-breakpoint
CREATE INDEX "scenarios_user_idx" ON "scenarios" USING btree ("user_id","is_active");