# Step 4A — Scenario CRUD

## Purpose

Step 4A adds lightweight what-if scenarios to PersFinance without changing the existing forecast shape. A scenario is a named, versioned set of hypothetical adjustments that can be stacked on top of the baseline projection.

This step intentionally does not add forecasting math changes beyond applying scenario adjustments on top of the existing projection.

## Scope

In scope:
- scenarios table
- scenario_adjustments table
- scenario_accounts join table
- CRUD for scenarios and adjustments
- scenario overlay input for the projection service
- forecast page scenario selection UI

Out of scope for Step 4A:
- Email marketing
- Matomo
- Client portal authentication changes
- Production data migration beyond the baseline scenario tables

## Data Model

### scenarios

Represents a named what-if scenario.

| Field | Notes |
|-------|-------|
| id | UUID primary key |
| name | Unique within active set |
| description | Optional |
| notes | Optional |
| active | Soft delete flag |

Behavior:
- Deletes are avoided in favor of archive.
- active + name has a unique index to keep active names distinct.

### scenario_accounts

Links a scenario to one or more accounts.

| Field | Notes |
|-------|-------|
| scenario_id | References scenarios |
| account_id | References accounts |

The projection service only applies adjustments when the selected scenario is linked to the projected account.

### scenario_adjustments

Represents an adjustment line inside a scenario.

| Field | Notes |
|-------|-------|
| id | UUID primary key |
| scenario_id | Parent scenario |
| account_id | Affected account |
| date | Effective date |
| amount | Non-zero adjustment |
| payee_id | Optional payee link |
| category_id | Optional category link |
| description | Optional text |
| notes | Optional text |

Constraints and indexes:
- amount <> 0
- default date order index on account + date
- account + scenario index for scenario lookups

## Multi-Account Behavior

A single scenario can include adjustments for multiple accounts. This matches the intent that a what-if can span related accounts.

When projecting an account:
- Only adjustments for linked accounts are considered.
- Multiple selected scenarios can each contribute adjustments.

## Stacking Behavior

The forecast page supports selecting multiple scenarios at once. Their adjustments are merged into one sorted overlay and applied on top of the baseline projection.

Expected behavior:
- All selected scenarios are applied.
- Scenario adjustments sort after baseline commitments, transfers, and future transactions.
- The same-day projection order remains intact: commitment, transfer, future transaction, scenario adjustment.
- Each selected scenario remains identifiable by scenarioId in projection items.

## Forecast Behavior

Scenario adjustments:
- Are not persisted to register transactions.
- Are not reconciled.
- Do not modify the source of truth account balance.
- Are displayed in the forecast only.

The starting balance for the forecast remains the same as the baseline projection.

## User Flow

1. Create or edit a scenario.
2. Assign accounts and add adjustments.
3. Open the account forecast page.
4. Select one or more scenarios.
5. Forecast applies the merged scenario overlay.
6. Clear selections to return to baseline.

## Relationship to Other Steps

Step 4A does not revisit transfer rules, commitment logic, or register behavior. It assumes Step 1 through Step 3 remain authoritative for baseline projection behavior.
