CREATE TYPE "public"."optimization_category" AS ENUM('banking', 'subscription', 'insurance', 'utilities', 'shopping', 'mobility', 'other');--> statement-breakpoint
CREATE TYPE "public"."optimization_status" AS ENUM('idea', 'planned', 'completed', 'dismissed');--> statement-breakpoint
CREATE TABLE "optimizations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"category" "optimization_category" DEFAULT 'other' NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"current_monthly_minor" bigint NOT NULL,
	"alternative_monthly_minor" bigint DEFAULT 0 NOT NULL,
	"one_time_cost_minor" bigint DEFAULT 0 NOT NULL,
	"status" "optimization_status" DEFAULT 'idea' NOT NULL,
	"target_date" date,
	"completed_at" date,
	"current_account_id" text,
	"replacement_account_id" text,
	"recurring_payment_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "optimizations" ADD CONSTRAINT "optimizations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimizations" ADD CONSTRAINT "optimizations_current_account_id_accounts_id_fk" FOREIGN KEY ("current_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimizations" ADD CONSTRAINT "optimizations_replacement_account_id_accounts_id_fk" FOREIGN KEY ("replacement_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimizations" ADD CONSTRAINT "optimizations_recurring_payment_id_recurring_payments_id_fk" FOREIGN KEY ("recurring_payment_id") REFERENCES "public"."recurring_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "optimizations_user_status_idx" ON "optimizations" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "optimizations_user_recurring_unique" ON "optimizations" USING btree ("user_id","recurring_payment_id") WHERE "optimizations"."recurring_payment_id" is not null;