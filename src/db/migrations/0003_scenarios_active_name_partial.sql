CREATE TABLE IF NOT EXISTS "scenarios" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "description" text,
  "notes" text,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scenario_accounts" (
  "scenario_id" uuid NOT NULL REFERENCES "scenarios" ("id") ON DELETE cascade,
  "account_id" uuid NOT NULL REFERENCES "accounts" ("id") ON DELETE cascade,
  CONSTRAINT "scenario_accounts_scenario_id_account_id_pk" PRIMARY KEY ("scenario_id","account_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scenario_adjustments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "scenario_id" uuid NOT NULL REFERENCES "scenarios" ("id") ON DELETE cascade,
  "account_id" uuid NOT NULL REFERENCES "accounts" ("id") ON DELETE cascade,
  "date" date NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "payee_id" uuid REFERENCES "payees" ("id") ON DELETE set null,
  "category_id" uuid REFERENCES "categories" ("id") ON DELETE set null,
  "description" text,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scenario_adjustments_account_scenario_idx"
  ON "scenario_adjustments" ("scenario_id", "account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scenario_adjustments_account_date_idx"
  ON "scenario_adjustments" ("account_id", "date");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scenario_adjustments" ADD CONSTRAINT "scenario_adjustments_amount_check" CHECK ("amount" <> 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  duplicate_names text;
BEGIN
  SELECT string_agg(duplicate_name, ', ' ORDER BY duplicate_name)
  INTO duplicate_names
  FROM (
    SELECT lower("name") AS duplicate_name
    FROM "scenarios"
    WHERE "active" = true
    GROUP BY lower("name")
    HAVING count(*) > 1
  ) duplicates;

  IF duplicate_names IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot create scenarios_active_name_unique: duplicate active scenario names after lower(name): %', duplicate_names;
  END IF;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "scenarios_active_name_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scenarios_active_name_unique"
  ON "scenarios" (lower("name"))
  WHERE "active" = true;
