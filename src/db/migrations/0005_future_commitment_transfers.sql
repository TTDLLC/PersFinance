do $$ begin
  create type "public"."commitment_kind" as enum('transaction', 'transfer');
exception
  when duplicate_object then null;
end $$;
--> statement-breakpoint
alter table "future_commitments"
  add column if not exists "kind" "commitment_kind" not null default 'transaction';
--> statement-breakpoint
alter table "future_commitments"
  add column if not exists "transfer_from_account_id" uuid references "accounts" ("id") on delete set null;
--> statement-breakpoint
alter table "future_commitments"
  add column if not exists "transfer_to_account_id" uuid references "accounts" ("id") on delete set null;
--> statement-breakpoint
create index if not exists "future_commitments_transfer_from_due_idx"
  on "future_commitments" ("transfer_from_account_id", "include_in_baseline", "active", "next_due_date");
--> statement-breakpoint
create index if not exists "future_commitments_transfer_to_due_idx"
  on "future_commitments" ("transfer_to_account_id", "include_in_baseline", "active", "next_due_date");
--> statement-breakpoint
do $$ begin
  alter table "future_commitments"
    add constraint "future_commitments_transfer_accounts_check"
    check (
      "kind" <> 'transfer'
      or (
        "transfer_from_account_id" is not null
        and "transfer_to_account_id" is not null
        and "transfer_from_account_id" <> "transfer_to_account_id"
      )
    );
exception
  when duplicate_object then null;
end $$;
