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
