# Parking Lot

## Transfer Concurrency Hardening

Review transfer locking for future multi-user architecture. The Step 2 transfer
service enforces paired create/edit/delete workflows, but a future hardening
pass should evaluate database-level invariants and explicit row locking around
concurrent reconciliation, transfer edits, and transfer deletion.
