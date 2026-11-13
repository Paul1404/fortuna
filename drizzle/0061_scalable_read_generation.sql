ALTER TABLE "external_connections" ADD COLUMN "scalable_read_generation" integer;--> statement-breakpoint
UPDATE "external_connections" SET "scalable_read_generation" = 0 WHERE "scalable_read_generation" IS NULL;--> statement-breakpoint
ALTER TABLE "external_connections" ALTER COLUMN "scalable_read_generation" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "external_connections" ALTER COLUMN "scalable_read_generation" SET NOT NULL;
