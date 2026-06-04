# PersFinance 1.0 Cleanup Tracker

## Completed Phase 1-4 Cleanup

Core 1.0 workflow:

- Account register and `transactions` are the source of truth.
- Future-dated activity is represented by future-dated register transactions.
- Recurring activity uses register transactions with recurring lifecycle metadata.
- Reconciliation uses account statements, balance snapshots, and statement-locked register transactions.
- Projections are rebuilt from active accounts, register transactions, and balance snapshots.

Old model database cleanup completed in Phase 3 by `src/db/migrations/0006_old_model_database_cleanup.sql`:

- Dropped `future_transactions`
- Dropped `recurring_transactions`
- Dropped `projection_settings`
- Dropped `accounts.include_in_projection`
- Dropped old-only enum types:
  - `future_transaction_status`
  - `future_transaction_type`
  - `recurring_kind`
  - `recurring_status`

Intentionally retained:

- Historical migration SQL and Drizzle snapshot metadata still describe the schema at those migration points and should remain immutable.
- `amount_type`, `payment_method`, and `schedule_type` remain active because the register `transactions` lifecycle uses them.

## Completed Phase 5 Polish

- `REGISTER_FUTURE_WINDOW_DAYS` is now configured by environment through `src/config/env.ts`.
- The default register future window remains 60 days.
- Settings displays the active register future window as read-only launch configuration.
- Main navigation reflects the active 1.0 workflow: Dashboard, Accounts, Register, Categories, Projections, Settings.
- The old projection placeholder was replaced by the register-based projections page.
- Scenarios are deferred to 1.1 and the `/scenarios` route is intentionally disabled for the active 1.0 app.

## Remaining 1.0 Items

No known functional blockers remain for the 1.0 register, reconciliation, balance, or projection workflows.

Operational launch checks still apply:

- Confirm production `DATABASE_URL` and `SESSION_SECRET`.
- Set `REGISTER_FUTURE_WINDOW_DAYS` if production should use a value other than 60.
- Run migrations against the launch database.
- Run the smoke checks against the launch database before opening the app to users.

## Deferred Post-1.0 / 1.1 Items

- Register-native scenario assignment model.
- Scenario projections once that register-native model exists.
- Advanced projection reporting, summaries, and charts.
- Dashboard enhancements beyond current working-balance and planning entry points.
- Editable settings UI for runtime preferences if needed after launch.
