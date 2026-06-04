# PersFinance 1.0 Cleanup Tracker

## Old database cleanup

Completed in Phase 3 by `src/db/migrations/0006_old_model_database_cleanup.sql`:

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

## Projection rebuild

The old projection implementation was removed because it depended on `future_transactions` and standalone `recurring_transactions`.

Rebuild target: implement projections from the 1.0 source of truth:

- register `transactions`
- future-dated register transactions
- register recurring lifecycle metadata
- latest account balance snapshots
- statement-locked transactions excluded from post-snapshot activity
- scenarios only after the register-based projection shape is clear

## Register configuration follow-up

- `REGISTER_FUTURE_WINDOW_DAYS` is centralized in `src/services/accountRegister.service.ts` and currently fixed at 60 days.
- Add user/app configuration for the active register future window after the core 1.0 register workflow settles.
