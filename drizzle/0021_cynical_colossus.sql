CREATE TYPE "public"."observation_severity" AS ENUM('info', 'notable', 'review', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."observation_status" AS ENUM('open', 'dismissed', 'intentional', 'snoozed', 'resolved');--> statement-breakpoint
CREATE TABLE "financial_observations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"severity" "observation_severity" NOT NULL,
	"status" "observation_status" DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"explanation" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"source_entities" jsonb NOT NULL,
	"currency" text,
	"impact_minor" bigint,
	"confidence" text NOT NULL,
	"period_start" date,
	"period_end" date,
	"actionable" boolean DEFAULT false NOT NULL,
	"first_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"minimum_cash_reserve_minor" bigint,
	"target_net_worth_minor" bigint,
	"target_net_worth_date" date,
	"monthly_savings_target_minor" bigint,
	"large_purchase_threshold_minor" bigint,
	"unusual_spend_multiplier_bps" integer DEFAULT 25000 NOT NULL,
	"alert_sensitivity" text DEFAULT 'balanced' NOT NULL,
	"ignored_category_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"weekly_report_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_review_runs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"last_attempted_at" timestamp with time zone,
	"last_succeeded_at" timestamp with time zone,
	"last_error_class" text
);
--> statement-breakpoint
ALTER TABLE "financial_observations" ADD CONSTRAINT "financial_observations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_profiles" ADD CONSTRAINT "financial_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_review_runs" ADD CONSTRAINT "financial_review_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "financial_observations_user_key_unique" ON "financial_observations" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX "financial_observations_user_status_idx" ON "financial_observations" USING btree ("user_id","status");