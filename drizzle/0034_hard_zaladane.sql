-- The contract-document index already exists in a development database
-- that received an uncommitted migration, so both creations are idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_iban_unique" ON "accounts" USING btree ("user_id",upper(replace("iban", ' ', '')),"currency") WHERE "accounts"."iban" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_documents_contract_sha_unique" ON "contract_documents" USING btree ("contract_id","sha256");