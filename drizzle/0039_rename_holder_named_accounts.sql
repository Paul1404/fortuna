-- Banks answer the account-information call with the ACCOUNT HOLDER as the
-- account name, so every account a provider created carried the owner's own
-- name: three connected accounts all called "Paul Dresch", indistinguishable
-- from each other and from a manually created account of the same name.
--
-- Deliberately narrow. Only an account that a provider created, that still
-- carries an institution, and whose name is shared with ANOTHER account is
-- renamed — a name shared across two institutions cannot be an account name.
-- A name the owner chose themselves is never touched, and the rename is
-- skipped where it would create a new collision.
UPDATE "accounts" a
SET "name" = a."institution"
WHERE a."provider_account_id" IS NOT NULL
  AND a."institution" IS NOT NULL
  AND a."institution" <> ''
  AND EXISTS (
    SELECT 1 FROM "accounts" b
    WHERE b."user_id" = a."user_id" AND b."id" <> a."id" AND b."name" = a."name"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "accounts" c
    WHERE c."user_id" = a."user_id" AND c."id" <> a."id"
      AND c."name" = a."institution"
  );
