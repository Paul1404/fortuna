CREATE TABLE "account_projections" (
	"account_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"monthly_contribution_minor" bigint DEFAULT 0 NOT NULL,
	"contribution_share_bps" integer DEFAULT 10000 NOT NULL,
	"cautious_return_bps" integer DEFAULT 100 NOT NULL,
	"expected_return_bps" integer DEFAULT 300 NOT NULL,
	"optimistic_return_bps" integer DEFAULT 500 NOT NULL,
	"horizon_years" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_projections" ADD CONSTRAINT "account_projections_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_projections" ADD CONSTRAINT "account_projections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;