CREATE TABLE "mcp_rate_limit" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" bigint NOT NULL
);
