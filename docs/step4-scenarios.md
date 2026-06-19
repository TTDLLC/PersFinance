# Step 4 — Scenarios and Forecast Overlay

> Historical note: Step 4.5 supersedes the active scenario item model described here. Scenario metadata still exists, but planning items now live in `future_commitments` as Scenario Commitments. See `docs/STEP_4_5_SCENARIO_COMMITMENTS.md`.

## Purpose
PersFinance already supports baseline forecasting across commitments, transfers, and future transactions. Step 4 introduced lightweight what-if planning. Step 4.5 is the current active model for scenario planning items.

## Scope
Historical scope:
- Scenario CRUD (Step 4A)
- Scenario adjustments with multi-account support
- Forecast overlay with multiple simultaneous scenarios (Step 4B)
- Scenario selection on the existing forecast page
- Documentation and smoke coverage for both pieces

Out of scope:
- Email marketing
- Matomo
- Production payment data or PCI changes
- Forecast persistence or dashboard analytics

## Behavior
Stays read-only. In the current model, a scenario is a metadata container whose scenario-only commitments are applied on top of the baseline projection only when selected. Baseline transactions, commitments, transfers, and statements remain authoritative.

## Same-Day Ordering
Baseline same-day order:
1. future_commitment
2. transfer
3. future_transaction

Scenario overlay order:
4. scenario_commitment

Scenario items appear after all baseline items on each date.

## Storage
Scenarios are the first PersFinance feature that stores intentionally hypothetical data. They are separated from the register so they never blur with actual transactions.

## Browser User Flow
1. Open `/scenarios`.
2. Create or edit scenario metadata.
3. Add scenario commitments from the scenario detail page.
4. Open an account forecast page.
5. Select one or more scenarios with active scenario-only commitments for that account.
6. Forecast applies the merged scenario commitment overlay.
7. Clear selections to return to baseline.

## Acceptance Criteria
- Users can create, edit, archive, and list scenarios.
- Scenario commitments can be added, edited, archived, and promoted within a scenario.
- Accounts are derived from scenario commitments.
- Forecast pages let users select multiple scenarios only when they have active scenario-only commitments for the account.
- Projection math includes scenario commitments after baseline items.
- Baseline projection remains unchanged when no scenario is selected.
- Docs and basic automated coverage exist for the new behavior.
