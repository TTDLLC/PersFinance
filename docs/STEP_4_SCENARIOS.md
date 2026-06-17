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

Scenarios are active by default. Archived scenarios remain visible through the Scenarios page when "Show archived" is enabled, but they are not offered on normal forecast pages and are ignored if their IDs are passed in forecast query parameters.

Forecast behavior remains baseline-only unless at least one selected scenario is active and linked to the projected account. The projection service returns the accepted scenario IDs so the UI only shows "Scenario overlay active" when an active overlay is actually applied.

## User Flow

1. Open `/scenarios`.
2. Create or edit a scenario and link it to one or more accounts.
3. Open the scenario detail page to add, edit, or delete dated adjustments.
4. Open an account forecast page and select one or more active linked scenarios.
5. Use "Clear scenarios" to return the forecast to the unchanged baseline.

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

Active scenario names are unique through a partial unique index on active scenario rows. Archived rows can keep duplicate historical names without blocking active scenario creation or restore flows.

## Smoke Coverage

`npm run test:step4-scenarios` now covers the mounted/authenticated `/scenarios` route, HTTP create/edit/detail/archive flows, single and multi-account link updates, adjustment add/edit/delete, active-only forecast option display, stacked overlays, archived-ID rejection, and projection immutability for transactions, statements, and accounts.

## Acceptance Criteria

- Users can create, edit, archive, and list scenarios.
- Scenarios can be linked to one or more accounts.
- Adjustments can be added, edited, and deleted within a scenario.
- Forecast pages let users select multiple scenarios.
- Projection math includes scenario adjustments after baseline items.
- Archived scenarios do not apply to projections.
- Baseline projection remains unchanged when no scenario is selected.
- Docs and basic automated coverage exist for the new behavior.
