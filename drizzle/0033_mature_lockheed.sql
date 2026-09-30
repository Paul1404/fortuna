-- Detection could insert a second row for one match key when two runs raced.
-- Keep the oldest of each group, move everything that pointed at a duplicate
-- onto it, then remove the duplicates so the index below can be created.
WITH ranked AS (
  SELECT id, user_id, match_key,
         first_value(id) OVER (
           PARTITION BY user_id, match_key ORDER BY created_at, id
         ) AS keeper
  FROM recurring_payments
  WHERE match_key IS NOT NULL
), dupes AS (
  SELECT id, keeper FROM ranked WHERE id <> keeper
)
UPDATE transactions t SET recurring_payment_id = d.keeper
FROM dupes d WHERE t.recurring_payment_id = d.id;
--> statement-breakpoint
WITH ranked AS (
  SELECT id, user_id, match_key,
         first_value(id) OVER (
           PARTITION BY user_id, match_key ORDER BY created_at, id
         ) AS keeper
  FROM recurring_payments
  WHERE match_key IS NOT NULL
), dupes AS (
  SELECT id, keeper FROM ranked WHERE id <> keeper
)
UPDATE contracts c SET recurring_payment_id = d.keeper
FROM dupes d WHERE c.recurring_payment_id = d.id;
--> statement-breakpoint
WITH ranked AS (
  SELECT id, user_id, match_key,
         first_value(id) OVER (
           PARTITION BY user_id, match_key ORDER BY created_at, id
         ) AS keeper
  FROM recurring_payments
  WHERE match_key IS NOT NULL
)
DELETE FROM recurring_payments r
USING ranked WHERE r.id = ranked.id AND ranked.id <> ranked.keeper;
--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_match_key_unique" ON "recurring_payments" USING btree ("user_id","match_key") WHERE "recurring_payments"."match_key" is not null;
