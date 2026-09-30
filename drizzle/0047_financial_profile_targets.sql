ALTER TABLE "financial_profiles" ADD COLUMN "goal_name" text;--> statement-breakpoint
ALTER TABLE "financial_profiles" ADD COLUMN "reserve_months" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_profiles" ADD COLUMN "target_equity_bps" integer DEFAULT 7000 NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_profiles" ADD COLUMN "target_bond_bps" integer DEFAULT 2000 NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_profiles" ADD COLUMN "target_cash_bps" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_profiles" ADD COLUMN "target_other_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Backfill from the Anlageplan (investment_policies), which stops being read
-- in 0.59.0. The split and reserve months come over as they were. The goal
-- comes over as one unit (name, amount, date) only where the profile had no
-- goal amount of its own; the savings rate only where the profile had none.
INSERT INTO "financial_profiles" (
	"user_id", "currency", "goal_name", "target_net_worth_minor",
	"target_net_worth_date", "monthly_savings_target_minor", "reserve_months",
	"target_equity_bps", "target_bond_bps", "target_cash_bps", "target_other_bps"
)
SELECT
	p."user_id",
	COALESCE(s."base_currency", 'EUR'),
	p."goal_name",
	p."target_amount_minor",
	p."target_date",
	NULLIF(p."monthly_contribution_minor", 0),
	p."emergency_reserve_months",
	p."target_equity_bps",
	p."target_bond_bps",
	p."target_cash_bps",
	p."target_other_bps"
FROM "investment_policies" p
LEFT JOIN "user_settings" s ON s."user_id" = p."user_id"
ON CONFLICT ("user_id") DO UPDATE SET
	"goal_name" = CASE WHEN "financial_profiles"."target_net_worth_minor" IS NULL
		THEN EXCLUDED."goal_name" ELSE "financial_profiles"."goal_name" END,
	"target_net_worth_date" = CASE WHEN "financial_profiles"."target_net_worth_minor" IS NULL
		THEN EXCLUDED."target_net_worth_date" ELSE "financial_profiles"."target_net_worth_date" END,
	"target_net_worth_minor" = COALESCE("financial_profiles"."target_net_worth_minor", EXCLUDED."target_net_worth_minor"),
	"monthly_savings_target_minor" = COALESCE("financial_profiles"."monthly_savings_target_minor", EXCLUDED."monthly_savings_target_minor"),
	"reserve_months" = EXCLUDED."reserve_months",
	"target_equity_bps" = EXCLUDED."target_equity_bps",
	"target_bond_bps" = EXCLUDED."target_bond_bps",
	"target_cash_bps" = EXCLUDED."target_cash_bps",
	"target_other_bps" = EXCLUDED."target_other_bps",
	"updated_at" = now();
