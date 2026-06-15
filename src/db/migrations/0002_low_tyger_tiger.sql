CREATE TYPE "public"."commitment_frequency" AS ENUM('once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "future_commitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"payee_id" uuid,
	"category_id" uuid,
	"account_id" uuid,
	"amount" numeric(12, 2) NOT NULL,
	"frequency" "commitment_frequency" NOT NULL,
	"next_due_date" date NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "future_commitments_date_range_check" CHECK ("future_commitments"."end_date" is null or "future_commitments"."end_date" >= "future_commitments"."start_date"),
	CONSTRAINT "future_commitments_nonzero_amount_check" CHECK ("future_commitments"."amount" <> 0)
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "transfer_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "future_commitments" ADD CONSTRAINT "future_commitments_payee_id_payees_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."payees"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "future_commitments" ADD CONSTRAINT "future_commitments_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "future_commitments" ADD CONSTRAINT "future_commitments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "future_commitments_due_idx" ON "future_commitments" USING btree ("active","next_due_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "future_commitments_account_due_idx" ON "future_commitments" USING btree ("account_id","active","next_due_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_transfer_idx" ON "transactions" USING btree ("transfer_id");