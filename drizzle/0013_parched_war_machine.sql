CREATE TYPE "public"."investment_asset_class" AS ENUM('global_equity', 'regional_equity', 'single_stock', 'bonds', 'money_market', 'real_assets', 'speculative', 'other');--> statement-breakpoint
CREATE TABLE "investment_policies" (
	"user_id" text PRIMARY KEY NOT NULL,
	"goal_name" text,
	"target_amount_minor" bigint,
	"target_date" date,
	"monthly_contribution_minor" bigint DEFAULT 0 NOT NULL,
	"emergency_reserve_months" integer DEFAULT 3 NOT NULL,
	"max_drawdown_bps" integer DEFAULT 0 NOT NULL,
	"target_equity_bps" integer DEFAULT 7000 NOT NULL,
	"target_bond_bps" integer DEFAULT 2000 NOT NULL,
	"target_cash_bps" integer DEFAULT 1000 NOT NULL,
	"target_other_bps" integer DEFAULT 0 NOT NULL,
	"rebalance_band_bps" integer DEFAULT 500 NOT NULL,
	"max_single_position_bps" integer DEFAULT 2000 NOT NULL,
	"max_product_cost_bps" integer DEFAULT 50 NOT NULL,
	"minimum_broad_market_bps" integer DEFAULT 8000 NOT NULL,
	"review_interval_months" integer DEFAULT 12 NOT NULL,
	"last_reviewed_at" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "asset_class" "investment_asset_class" DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "annual_cost_bps" integer;--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "broadly_diversified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "securities" ADD COLUMN "risk_class" integer;--> statement-breakpoint
ALTER TABLE "investment_policies" ADD CONSTRAINT "investment_policies_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
