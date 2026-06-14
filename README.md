# PersFinance

A focused internal personal finance register app. This build centers on factual account information:

- Accounts
- Account register
- Account-specific CSV transaction import with preview and rollback
- Statements
- Reconciliation
- Current Balance

Deferred in this pass: projections, scenarios, recurring transactions, future planning items, transfers, split transactions, snapshots, dashboard totals, and balance caching.

## Required Software

- Node.js 20+
- PostgreSQL 15+
- npm

## Environment Setup

```bash
cp .env.example .env
```

Update `.env` with your database password, session secret, and initial admin credentials:

```env
DATABASE_URL=postgresql://finance_app:change-this-password@localhost:5432/finance_projection
SESSION_SECRET=use-a-long-random-secret
INITIAL_ADMIN_EMAIL=robert@example.com
INITIAL_ADMIN_PASSWORD=change-me-to-a-real-password
SEED_DEMO_DATA=false
```

Do not commit `.env`.

## Install Dependencies

```bash
npm install
```

## Database

This internal rewrite uses a clean reset/rebuild strategy. Recreate the local database, then run:

```bash
npm run db:migrate
npm run seed
```

For demo accounts as well:

```bash
npm run seed:dev
```

## Development

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Smoke Checks

```bash
npm run test:balance
npm run test:register
npm run test:import
npm run test:large-import
```

See [Step 1 CSV Import and Foundation Review](docs/STEP_1_IMPORT_AND_FOUNDATION_REVIEW.md) for the supported CSV format, duplicate and payee behavior, rollback rules, validation plan, and scoped operational findings.

## Core Balance Rule

Only the singular `Account` service calculates Current Balance:

```text
Current Balance =
  account.statement_chain_balance
  + sum(active non-void transactions)
```

Active non-void transactions are rows where:

```text
statement_id is null
and status != 'void'
```
