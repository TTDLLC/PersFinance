# Step 4A — Scenario CRUD

> Historical note: Step 4.5 supersedes the account-link and scenario-adjustment workflow described here. Scenario metadata still exists in `scenarios`, but planning items now live in `future_commitments` as Scenario Commitments. Scenario creation is metadata-only, accounts are derived from scenario items, and overlays use active scenario-only commitments. See `docs/STEP_4_5_SCENARIO_COMMITMENTS.md`.

## Purpose

Step 4A added lightweight what-if scenarios to PersFinance without changing the existing forecast shape. In this historical design, a scenario was a named, versioned set of hypothetical adjustments that could be stacked on top of the baseline projection.

This step intentionally did not add forecasting math changes beyond applying scenario adjustments on top of the existing projection.

## Scope

Historical scope:
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

Represents a named what-if scenario. This remains current as scenario metadata.

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

Historically linked a scenario to one or more accounts. In the current Step 4.5 workflow, accounts are derived from scenario commitments instead.

| Field | Notes |
|-------|-------|
| scenario_id | References scenarios |
| account_id | References accounts |

The projection service only applies adjustments when the selected scenario is linked to the projected account.

### scenario_adjustments

Historically represented an adjustment line inside a scenario. In the current Step 4.5 workflow, scenario planning rows live in `future_commitments`.

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

A single scenario can still span multiple accounts, but current account membership comes from scenario commitments rather than from manual scenario-account assignment.

Historically, when projecting an account:
- Only adjustments for linked accounts are considered.
- Multiple selected scenarios can each contribute adjustments.

## Stacking Behavior

The forecast page still supports selecting multiple scenarios at once. In Step 4.5, active scenario-only commitments are merged into the overlay instead of scenario adjustments.

Expected behavior:
- All selected scenarios are applied.
- Scenario commitments sort after baseline commitments, transfers, and future transactions.
- The same-day projection order remains intact: commitment, transfer, future transaction, scenario commitment.
- Each selected scenario remains identifiable by scenarioId in projection items.

## Forecast Behavior

Scenario commitments:
- Are not persisted to register transactions.
- Are not reconciled.
- Do not modify the source of truth account balance.
- Are displayed in the forecast only.

The starting balance for the forecast remains the same as the baseline projection.

## User Flow

1. Create or edit scenario metadata.
2. Add scenario commitments on the scenario detail page.
3. Open the account forecast page.
4. Select one or more scenarios that have active scenario-only commitments for that account.
5. Forecast applies the merged scenario overlay.
6. Clear selections to return to baseline.

## Relationship to Other Steps

Step 4A does not revisit transfer rules, commitment logic, or register behavior. It assumes Step 1 through Step 3 remain authoritative for baseline projection behavior.
