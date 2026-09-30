CREATE TABLE "investment_decisions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"mode" text NOT NULL,
	"verdict" text NOT NULL,
	"headline" text NOT NULL,
	"note" text,
	"currency" text NOT NULL,
	"broker_cash_minor" bigint NOT NULL,
	"orders" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "investment_decisions" ADD CONSTRAINT "investment_decisions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investment_decisions_user" ON "investment_decisions" USING btree ("user_id","created_at");