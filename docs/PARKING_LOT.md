# Parking Lot

## Transfer Concurrency Hardening

Review transfer locking for future multi-user architecture. The Step 2 transfer
service enforces paired create/edit/delete workflows, but a future hardening
pass should evaluate database-level invariants and explicit row locking around
concurrent reconciliation, transfer edits, and transfer deletion.

## Account Register Filter Polish

Restyle the Account Register multi-status filter so it feels more native to the
PersFinance UI. The current checkbox behavior works well, but the visual
treatment still feels closer to default browser controls than the rest of the
app.
