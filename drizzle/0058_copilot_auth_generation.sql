ALTER TABLE "external_connections" ADD COLUMN "copilot_auth_generation" bigint;
UPDATE "external_connections" SET "copilot_auth_generation" = 0 WHERE "copilot_auth_generation" IS NULL;
ALTER TABLE "external_connections" ALTER COLUMN "copilot_auth_generation" SET DEFAULT 0;
ALTER TABLE "external_connections" ALTER COLUMN "copilot_auth_generation" SET NOT NULL;
