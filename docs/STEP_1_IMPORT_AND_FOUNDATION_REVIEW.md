# Step 1: CSV Import and Foundation Review

## Purpose

Step 1 adds a minimal, account-specific CSV transaction import workflow and prepares PersFinance for operational review with larger registers.

This work intentionally excludes OFX/QFX, bank feeds, fuzzy matching, category rules, auto-reconciliation, and recurring or future transaction detection.

## Import Workflow

1. Open an individual account register.
2. Select **Import CSV**.
3. Upload a `.csv` file up to 5 MB.
4. Review every row before any transaction, payee, or import batch is written.
5. Correct errors in the source CSV and upload it again when needed.
6. Confirm the preview. Valid non-duplicate rows are imported; duplicates are skipped unless explicitly selected.

Confirmed rows become normal `cleared` transactions with `statement_id = null`. Import never creates a statement or automatically reconciles a transaction.

## CSV Format

Column names are trimmed and matched without regard to case.

Required:

- `Date`: valid `YYYY-MM-DD`
- `Amount`: non-zero number with no more than two decimal places

Optional:

- `Payee`
- `Description`
- `Category`
- `Memo`
- `Reference`

Amounts may include commas, a dollar sign, or accounting parentheses. `Memo` is stored as transaction notes. `Reference` is stored separately on the transaction.

Each transaction must include a Payee, Description, or both. Rows where both values are blank are rejected consistently in CSV import and manual transaction forms.

When `Category` is present, it must exactly match an active managed category. Import does not create categories.

## Payee Behavior

Payee names use trimmed, case-insensitive exact matching against active managed payees.

- An exact match reuses the existing payee.
- A missing payee is labeled **New payee will be created** in preview.
- Confirmation creates the missing payee as a normal active payee.
- Import-created payees store `source = csv_import` and reference the creating import batch.
- Fuzzy matching is not performed.

## Duplicate Behavior

Duplicate detection v1 compares:

- Account
- Date
- Amount
- Payee exact name, or Description when Payee is blank

The preview checks both existing account transactions and earlier valid rows in the same CSV. Duplicates remain visible and are skipped by default. A user may explicitly include a duplicate from the preview.

This is application-level preview detection, not a database uniqueness constraint.

## Import Batches and Rollback

Every confirmed import records:

- Account
- Filename
- Total CSV rows
- Imported rows
- Duplicate rows
- Error rows
- Created timestamp

Imported transactions reference the batch.

A batch can be deleted only while all of its imported transactions have `statement_id = null`. Rollback deletes the imported transactions and deletes payees created by that batch only when no other transaction uses them. Once any transaction in the batch is reconciled, the entire batch is locked from rollback.

## Large Dataset Validation

Run:

```bash
npm run test:large-import
```

The check generates CSV data in memory and defaults to 12,000 rows. It validates:

- CSV parsing and preview
- Confirmed transaction count
- Chunked transactional writes above PostgreSQL's practical single-statement parameter limit
- Register loading with several thousand transactions
- Exact post-import balance
- Reconciliation of imported transactions
- Rollback refusal after reconciliation

Override the generated size when needed:

```bash
LARGE_IMPORT_ROWS=10000 npm run test:large-import
```

Validation on June 14, 2026, against local PostgreSQL 16:

| Rows | Preview | Import | Register query | Heap change through register |
| ---: | ---: | ---: | ---: | ---: |
| 12,000 | 65 ms | 782 ms | 66 ms | 31.7 MiB |
| 25,000 | 111 ms | 1,602 ms | 119 ms | 47.4 MiB |

Both runs completed balance verification, reconciliation, and rollback-lock checks. Timings are development-machine observations, not production guarantees. The 25,000-row generated CSV remained below the 5 MB upload limit.

The focused lifecycle check is:

```bash
npm run test:import
```

It covers exact payee/category matching, new payee creation, database and within-file duplicates, row validation, default duplicate skipping, transaction fields, balance effects, safe payee cleanup, rollback, and reconciliation locking.

## Operational Review Findings

These findings are intentionally not expanded into Step 1 feature work:

1. Register queries and rendering currently load every matching transaction. Pagination or windowing should be reviewed before routinely operating with much larger datasets.
2. Import previews are stored in the authenticated PostgreSQL session to preserve the no-write-before-confirmation rule. The 5 MB upload limit bounds this, but session storage and expiry behavior should be reviewed for larger imports and concurrent tabs.
3. Duplicate detection has no database constraint, so a concurrent transaction created after preview can bypass the preview result. A later import version should recheck under an account-scoped lock or define an intentional database strategy.
4. Payee and category exact matching is case-insensitive in application code, while existing database uniqueness indexes are case-sensitive. Normalized uniqueness should be reviewed across managed data.
5. The current smoke checks use the shared configured database and clean up named fixtures. A dedicated isolated test database would reduce operational risk.
6. `npm audit --omit=dev` reports the high-severity Drizzle ORM SQL identifier escaping advisory [GHSA-gpj5-g38j-94v9](https://github.com/advisories/GHSA-gpj5-g38j-94v9), with no fix currently offered by npm. PersFinance does not construct SQL identifiers from import input, but the dependency should remain on the operational upgrade watchlist.
7. Reconciliation and import rollback do not share an account-scoped database lock. Normal use is guarded correctly, but concurrent reconciliation and rollback requests should be hardened together in a later transaction-integrity pass.
8. Confirmation writes are chunked at 500 rows per SQL statement and remain inside one database transaction. The upload limit, session-preview size, full-register query, and browser rendering are expected to become practical limits before PostgreSQL bind parameters do.
9. Service-level register loading remained responsive at 25,000 rows, but the current HTML response still renders the entire register or preview. Browser DOM size is the first practical UI limit observed; pagination or virtualization should precede routine imports materially beyond this range.
