CREATE TABLE "broker_orders" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"decision_id" text,
	"order_key" text,
	"side" text NOT NULL,
	"isin" text NOT NULL,
	"instrument_name" text NOT NULL,
	"amount_minor" bigint,
	"shares" numeric(20, 8),
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"requires_acknowledgement" boolean DEFAULT false NOT NULL,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"encrypted_preview" text,
	"encrypted_result" text,
	"error_code" text,
	"expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broker_orders" ADD CONSTRAINT "broker_orders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_orders" ADD CONSTRAINT "broker_orders_decision_id_investment_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."investment_decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broker_orders_user" ON "broker_orders" USING btree ("user_id","created_at");