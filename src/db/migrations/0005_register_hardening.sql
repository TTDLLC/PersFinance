CREATE UNIQUE INDEX IF NOT EXISTS "transactions_recurring_group_date_unique"
ON "transactions" ("recurring_group_id", "date")
WHERE "recurring_group_id" IS NOT NULL AND "status" = 'recurring';
