ALTER TABLE "recurring_payments" ADD COLUMN "previous_amount_minor" bigint;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD COLUMN "price_changed_at" date;