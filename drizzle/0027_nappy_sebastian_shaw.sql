CREATE TABLE "scalable_market_closes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"currency" text NOT NULL,
	"confirmed_net_worth_minor" bigint NOT NULL,
	"indicative_net_worth_minor" bigint NOT NULL,
	"market_delta_minor" bigint NOT NULL,
	"quoted_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scalable_market_closes" ADD CONSTRAINT "scalable_market_closes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scalable_market_close_user_date" ON "scalable_market_closes" USING btree ("user_id","date");