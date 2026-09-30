CREATE TYPE "public"."copilot_memory_kind" AS ENUM('preference', 'rule', 'fact');--> statement-breakpoint
CREATE TABLE "copilot_memories" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"kind" "copilot_memory_kind" DEFAULT 'fact' NOT NULL,
	"content" text NOT NULL,
	"last_confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_documents" ALTER COLUMN "encrypted_content" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_documents" ADD COLUMN "storage_key" text;--> statement-breakpoint
ALTER TABLE "copilot_memories" ADD CONSTRAINT "copilot_memories_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "copilot_memories_user_key_unique" ON "copilot_memories" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX "copilot_memories_user_idx" ON "copilot_memories" USING btree ("user_id","updated_at");