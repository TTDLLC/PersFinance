CREATE TABLE IF NOT EXISTS "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"filename" text,
	"total_rows" integer NOT NULL,
	"imported_rows" integer NOT NULL,
	"duplicate_rows" integer NOT NULL,
	"error_rows" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payees" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "payees" ADD COLUMN "created_by_import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "payee_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payee_or_description_check" CHECK ("payee_id" IS NOT NULL OR nullif(btrim("description"), '') IS NOT NULL);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_batches_account_created_idx" ON "import_batches" USING btree ("account_id","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payees" ADD CONSTRAINT "payees_created_by_import_batch_id_import_batches_id_fk" FOREIGN KEY ("created_by_import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_import_batch_idx" ON "transactions" USING btree ("import_batch_id");
