-- Scenario tables (Step 4A)
create table if not exists "scenarios" (
  "id" uuid primary key default gen_random_uuid(),
  "name" text not null,
  "description" text,
  "notes" text,
  "active" boolean not null default true,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create unique index if not exists "scenarios_active_name_unique"
  on "scenarios" ("name", "active");

create table if not exists "scenario_accounts" (
  "scenario_id" uuid not null references "scenarios" ("id") on delete cascade,
  "account_id" uuid not null references "accounts" ("id") on delete cascade,
  primary key ("scenario_id", "account_id")
);

create table if not exists "scenario_adjustments" (
  "id" uuid primary key default gen_random_uuid(),
  "scenario_id" uuid not null references "scenarios" ("id") on delete cascade,
  "account_id" uuid not null references "accounts" ("id") on delete cascade,
  "date" date not null,
  "amount" numeric(12, 2) not null,
  "payee_id" uuid references "payees" ("id") on delete set null,
  "category_id" uuid references "categories" ("id") on delete set null,
  "description" text,
  "notes" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create index if not exists "scenario_adjustments_account_scenario_idx"
  on "scenario_adjustments" ("scenario_id", "account_id");

create index if not exists "scenario_adjustments_account_date_idx"
  on "scenario_adjustments" ("account_id", "date");

alter table "scenario_adjustments"
  add constraint "scenario_adjustments_amount_check"
  check ("amount" <> 0);
