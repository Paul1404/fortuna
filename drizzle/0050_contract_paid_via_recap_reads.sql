CREATE TYPE "public"."contract_paid_via" AS ENUM('account', 'payroll');--> statement-breakpoint
CREATE TABLE "desk_recap_reads" (
	"user_id" text NOT NULL,
	"month" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "paid_via" "contract_paid_via" DEFAULT 'account' NOT NULL;--> statement-breakpoint
ALTER TABLE "desk_recap_reads" ADD CONSTRAINT "desk_recap_reads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "desk_recap_reads_user_month_unique" ON "desk_recap_reads" USING btree ("user_id","month");