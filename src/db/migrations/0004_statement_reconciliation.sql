CREATE TABLE IF NOT EXISTS "account_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"statement_date" date NOT NULL,
	"ending_balance" numeric(12, 2) NOT NULL,
	"reconciled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "statement_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_statements_account_date_idx" ON "account_statements" ("account_id","statement_date");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_statements" ADD CONSTRAINT "account_statements_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_statement_id_account_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."account_statements"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
