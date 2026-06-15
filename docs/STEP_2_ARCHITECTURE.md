# Step 2 Architecture

## Commitment account assignment

Step 2 uses one optional `account_id` on each future commitment.

This is the recommended foundation because most commitments have one expected
funding account, account registers need an inexpensive way to find their own
overdue commitments, and the due-entry workflow can preselect that account.
Keeping the field optional also supports commitments whose payment account is
not known yet.

Multi-account commitments should not be represented with multiple nullable
columns or serialized account identifiers. If allocation across accounts is
needed later, migrate to a `future_commitment_accounts` join table containing
`commitment_id`, `account_id`, and allocation metadata. The current
`future_commitments.account_id` values can be copied into that table without
changing commitment history.

## Separation of concerns

- Register transactions are actual known account activity.
- Future commitments are expected activity and never affect register balances
  until the user explicitly enters a due commitment.
- Scenarios remain outside both models and are not part of Step 2.

Entering a due commitment creates a normal `entered` register transaction and
advances the commitment only after that insert succeeds. No planned
transactions are created in advance.

## Transfers

A transfer is represented by exactly two normal transaction rows sharing a
`transfer_id`. The source amount is negative and the destination amount is
positive. Creation, editing, and deletion are performed by a dedicated service
inside database transactions.

If either row has a `statement_id`, the service rejects edits and deletion for
the whole transfer.
