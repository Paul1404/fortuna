ALTER TABLE "bank_connections" ADD COLUMN "sync_epoch" bigint;--> statement-breakpoint
UPDATE "bank_connections" SET "sync_epoch" = 0 WHERE "sync_epoch" IS NULL;--> statement-breakpoint
ALTER TABLE "bank_connections" ALTER COLUMN "sync_epoch" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "bank_connections" ALTER COLUMN "sync_epoch" SET NOT NULL;
