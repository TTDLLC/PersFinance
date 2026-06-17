# Step 4 — Scenarios and Forecast Overlay

## Purpose

PersFinance already supports baseline forecasting across commitments, transfers, and future transactions. Step 4 adds lightweight what-if planning so users can preview hypothetical adjustments before they enter or change anything.

## Scope

In scope:
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

Stays read-only. A scenario is a hypothetical set of adjustments applied on top of the baseline projection. Baseline transactions, commitments, transfers, and statements remain authoritative. Entering a forecast change still requires creating a real register transaction.

## Same-Day Ordering

Baseline same-day order:

1. future_commitment
2. transfer
3. future_transaction

Scenario overlay order:

4. scenario_adjustment

Scenario items appear after all baseline items on each date.

## Storage

Scenarios are the first PersFinance feature that stores intentionally hypothetical data. They are separated from the register so they never blur with actual transactions.

## Acceptance Criteria

- Users can create, edit, archive, and list scenarios.
- Scenarios can be linked to one or more accounts.
- Adjustments can be added, edited, and deleted within a scenario.
- Forecast pages let users select multiple scenarios.
- Projection math includes scenario adjustments after baseline items.
- Baseline projection remains unchanged when no scenario is selected.
- Docs and basic automated coverage exist for the new behavior.
