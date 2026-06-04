DROP TABLE IF EXISTS "projection_settings";--> statement-breakpoint
DROP TABLE IF EXISTS "future_transactions";--> statement-breakpoint
DROP TABLE IF EXISTS "recurring_transactions";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN IF EXISTS "include_in_projection";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."future_transaction_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."future_transaction_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."recurring_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."recurring_status";--> statement-breakpoint
