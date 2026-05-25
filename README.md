# Personal Finance Projection App

A standalone personal cash-flow projection app for Robert. The app is intended to replace a spreadsheet workflow for accounts, recurring income and bills, one-off future transactions, scenarios, and monthly balance projections.

This is a cash-flow projection tool, not a traditional budgeting app. Its core question is: what will balances look like over time based on expected income, bills, and planned future transactions?

## Required Software

- Node.js 20+
- PostgreSQL 15+
- npm

## PostgreSQL Setup

Example local setup:

```bash
sudo -u postgres psql
CREATE DATABASE finance_projection;
CREATE USER finance_app WITH ENCRYPTED PASSWORD 'change-this-password';
GRANT ALL PRIVILEGES ON DATABASE finance_projection TO finance_app;
\q
```

For Drizzle migrations, the app user also needs permission to create tables, enums, and extensions in the target database/schema. On newer PostgreSQL installs you may also need:

```sql
\c finance_projection
GRANT CREATE ON SCHEMA public TO finance_app;
ALTER DATABASE finance_projection OWNER TO finance_app;
```

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

## Run Migrations

This repo includes the initial Drizzle migration at `src/db/migrations/0001_clever_mockingbird.sql`.

```bash
npm run db:migrate
```

If you want to apply the initial SQL file directly instead:

```bash
psql "$DATABASE_URL" -f src/db/migrations/0001_clever_mockingbird.sql
```

After dependencies are installed, Drizzle can generate future migrations from `src/db/schema.ts`:

```bash
npm run db:generate
```

## Seed First User and Defaults

```bash
npm run seed
```

The seed script creates:

- Initial admin user from `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD`
- Default categories
- `Base Plan` scenario
- Default projection settings

To also create a small developer dataset with 2 accounts, recurring income, recurring bills, and a future vacation payment:

```bash
npm run seed:dev
```

You can also set `SEED_DEMO_DATA=true` before running `npm run seed`.

## Start Development Server

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Project Structure

```text
src/
  app.ts
  server.ts
  config/
  db/
    schema.ts
    migrations/
  middleware/
  routes/
  controllers/
  services/
  views/
  public/
scripts/
  seed.ts
```

## Functional Pages

- Login/logout
- Dashboard placeholder
- Accounts CRUD and archive
- Categories CRUD and archive
- Recurring transactions CRUD and archive
- Future transactions CRUD and delete
- Scenarios CRUD
- Monthly projection summary and generated rows
- Settings placeholder showing projection defaults

## Current Projection Scope

The projection service combines active projection account current balances, weekly/biweekly/monthly/semimonthly recurring transactions, and one-off future transactions. Custom schedules remain a documented placeholder.

Projection option behavior:

- `scenarioId` includes unassigned future transactions plus future transactions assigned to the selected scenario.
- `includeEstimates=false` excludes recurring estimates and future transactions with `estimate` status.
- `includePending=false` excludes pending recurring and future transactions.
- Cancelled future transactions are always excluded.
- Cleared future transactions are excluded from projections. Current account balances are treated as the source of truth, so including cleared future items would risk double-counting once balances have been updated.
- Monthly and semimonthly transactions scheduled for unavailable dates fall back to the last day of that month. For example, a bill set for the 31st runs on February 28 or 29 in leap years, April 30, June 30, September 30, and November 30.

Transfers can be entered and categorized, but balancing both sides of a transfer is still a future enhancement. Recurrence exceptions and advanced scenario overrides are also placeholders for later work.

## Validation

Create and update forms use Zod validation for required fields, enum values, dates, UUID references, and numeric amounts before writing to the database.
