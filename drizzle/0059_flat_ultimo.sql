ALTER TABLE "scalable_device_logins" DROP CONSTRAINT "scalable_device_logins_provider_check";--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN "presence_headers_rate_limited" boolean;--> statement-breakpoint
UPDATE "bank_connections" SET "presence_headers_rate_limited" = false WHERE "presence_headers_rate_limited" IS NULL;--> statement-breakpoint
ALTER TABLE "bank_connections" ALTER COLUMN "presence_headers_rate_limited" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "bank_connections" ALTER COLUMN "presence_headers_rate_limited" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "scalable_device_logins" ADD CONSTRAINT "scalable_device_logins_provider_check" CHECK ("scalable_device_logins"."provider" in ('scalable_hosted_cli', 'scalable_trading_cli'));
