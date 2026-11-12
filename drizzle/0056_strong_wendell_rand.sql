CREATE TABLE "categorisation_consult_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"encrypted_history" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categorisation_consult_sessions" ADD CONSTRAINT "categorisation_consult_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categorisation_consult_sessions_expiry_idx" ON "categorisation_consult_sessions" USING btree ("expires_at");