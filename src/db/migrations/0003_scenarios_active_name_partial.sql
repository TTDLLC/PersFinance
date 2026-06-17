DROP INDEX IF EXISTS "scenarios_active_name_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scenarios_active_name_unique"
  ON "scenarios" (lower("name"))
  WHERE "active" = true;
