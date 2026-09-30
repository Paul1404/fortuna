ALTER TABLE "assets" ADD COLUMN "sync_source" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "external_id" text;--> statement-breakpoint
UPDATE "assets"
SET "sync_source" = 'remise',
    "external_id" = substring("reference" from 8)
WHERE "reference" LIKE 'remise:%';--> statement-breakpoint
CREATE UNIQUE INDEX "assets_external_unique" ON "assets" USING btree ("user_id","sync_source","external_id") WHERE "assets"."sync_source" is not null and "assets"."external_id" is not null;
