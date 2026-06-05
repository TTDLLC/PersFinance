# PersFinance v1.0.0-internal Rewrite Notes

This internal rewrite replaces the experimental projection/snapshot model with the focused account/register foundation.

Active scope:

- Accounts
- Account register
- Statements
- Reconciliation
- Current Balance

Deferred:

- Projections
- Scenarios
- Recurring transactions
- Future planning items
- Transfers
- Split transactions
- Snapshots
- Dashboard totals
- Balance caching

Important conventions:

- Account creation stores Starting Information and initializes `statement_chain_balance`.
- Account creation does not create a synthetic statement row.
- `last_reconciled_statement_id` stays `null` until the first real statement is reconciled.
- The first real statement uses `previous_statement_id = "initial"`.
- Later statements use the previous statement UUID string in `previous_statement_id`.
- Only `Account.getBalance()` calculates Current Balance.
- Reconciled transaction history is determined by `statement_id is not null`, not by a special transaction status.
