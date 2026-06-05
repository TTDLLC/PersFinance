CREATE TYPE "public"."account_type" AS ENUM('checking', 'savings', 'credit_card', 'loan', 'cash', 'other');--> statement-breakpoint
CREATE TYPE "public"."category_type" AS ENUM('income', 'expense', 'debt', 'other');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('entered', 'pending', 'cleared', 'void');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"statement_date" date NOT NULL,
	"previous_statement_id" text NOT NULL,
	"starting_balance" numeric(12, 2) NOT NULL,
	"ending_balance" numeric(12, 2) NOT NULL,
	"reconciled_balance" numeric(12, 2) NOT NULL,
	"reconciled" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"starting_information_balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"starting_information_date" date NOT NULL,
	"starting_information_notes" text,
	"statement_chain_balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"last_reconciled_date" date,
	"last_reconciled_statement_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "category_type" NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transaction_tags" (
	"transaction_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_tags_transaction_id_tag_id_pk" PRIMARY KEY("transaction_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"status" "transaction_status" DEFAULT 'entered' NOT NULL,
	"statement_id" uuid,
	"payee_id" uuid NOT NULL,
	"description" text,
	"category_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_statements" ADD CONSTRAINT "account_statements_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_statement_id_account_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."account_statements"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payee_id_payees_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."payees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_statements_account_date_idx" ON "account_statements" USING btree ("account_id","statement_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_statements_account_reconciled_idx" ON "account_statements" USING btree ("account_id","reconciled");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payees_active_name_unique" ON "payees" USING btree ("name","active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tags_active_name_unique" ON "tags" USING btree ("name","active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_account_active_idx" ON "transactions" USING btree ("account_id","statement_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_account_date_idx" ON "transactions" USING btree ("account_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique" ON "users" USING btree ("email");