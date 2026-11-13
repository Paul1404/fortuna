CREATE TABLE "scalable_device_logins" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"generation" integer NOT NULL,
	"status" text NOT NULL,
	"worker_id" text,
	"lease_expires_at" timestamp with time zone,
	"encrypted_prompt" text,
	"prompt_expires_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scalable_device_logins_provider_check" CHECK ("scalable_device_logins"."provider" in ('scalable_hosted_cli', 'scalable_trading_cli')),
	CONSTRAINT "scalable_device_logins_status_check" CHECK ("scalable_device_logins"."status" in ('starting', 'pending', 'completed', 'failed', 'cancelled', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "scalable_device_logins" ADD CONSTRAINT "scalable_device_logins_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scalable_device_logins_user_provider_unique" ON "scalable_device_logins" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "scalable_device_logins_lease_idx" ON "scalable_device_logins" USING btree ("lease_expires_at");
