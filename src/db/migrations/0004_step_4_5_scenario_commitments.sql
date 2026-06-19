alter table "future_commitments"
  add column if not exists "scenario_id" uuid references "scenarios" ("id") on delete cascade;

alter table "future_commitments"
  add column if not exists "include_in_baseline" boolean not null default true;

create index if not exists "future_commitments_scenario_idx"
  on "future_commitments" ("scenario_id");

create index if not exists "future_commitments_scenario_baseline_idx"
  on "future_commitments" ("scenario_id", "include_in_baseline");

drop index if exists "future_commitments_due_idx";
create index if not exists "future_commitments_due_idx"
  on "future_commitments" ("include_in_baseline", "active", "next_due_date");

drop index if exists "future_commitments_account_due_idx";
create index if not exists "future_commitments_account_due_idx"
  on "future_commitments" ("account_id", "include_in_baseline", "active", "next_due_date");

insert into "future_commitments" (
  "name",
  "payee_id",
  "category_id",
  "account_id",
  "scenario_id",
  "include_in_baseline",
  "amount",
  "frequency",
  "next_due_date",
  "start_date",
  "end_date",
  "notes",
  "active",
  "created_at",
  "updated_at"
)
select
  coalesce(nullif(btrim("description"), ''), 'Scenario adjustment') as "name",
  "payee_id",
  "category_id",
  "account_id",
  "scenario_id",
  false as "include_in_baseline",
  "amount",
  'once'::commitment_frequency as "frequency",
  "date" as "next_due_date",
  "date" as "start_date",
  "date" as "end_date",
  "notes",
  true as "active",
  "created_at",
  "updated_at"
from "scenario_adjustments"
where not exists (
  select 1
  from "future_commitments"
  where "future_commitments"."scenario_id" = "scenario_adjustments"."scenario_id"
    and "future_commitments"."account_id" = "scenario_adjustments"."account_id"
    and "future_commitments"."next_due_date" = "scenario_adjustments"."date"
    and "future_commitments"."amount" = "scenario_adjustments"."amount"
    and coalesce("future_commitments"."payee_id"::text, '') = coalesce("scenario_adjustments"."payee_id"::text, '')
    and coalesce("future_commitments"."category_id"::text, '') = coalesce("scenario_adjustments"."category_id"::text, '')
    and coalesce("future_commitments"."notes", '') = coalesce("scenario_adjustments"."notes", '')
    and "future_commitments"."include_in_baseline" = false
);
