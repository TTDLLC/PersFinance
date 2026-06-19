# Step 4 — Scenarios and Forecast Overlay

## Purpose

PersFinance already supports baseline forecasting across commitments, transfers, and future transactions. Step 4 introduced lightweight what-if planning. Step 4.5 is the current active model for scenario planning items.

## Scope

Current active scope:
- Scenario metadata CRUD
- Scenario commitments stored in `future_commitments`
- Forecast overlays from active scenario-only commitments
- Promotion of scenario commitments into baseline planning
- Documentation and smoke coverage

Out of scope:
- Email marketing
- Matomo
- Production payment data or PCI changes
- Forecast persistence or dashboard analytics

## Behavior

Stays read-only. A scenario is a planning container. Scenario-only commitments are hypothetical scheduled items applied on top of the baseline projection only when the scenario is selected. Baseline transactions, commitments, transfers, and statements remain authoritative. Entering a forecast change still requires creating a real register transaction or entering a baseline commitment.

Scenarios are active by default. Archived scenarios remain visible through the Scenarios page when "Show archived" is enabled, but they are not offered on normal forecast pages and are ignored if their IDs are passed in forecast query parameters.

Step 4.5 moves scenario planning items onto `future_commitments` as Scenario Commitments. Scenario creation now captures metadata only; accounts are associated through scenario items. See `docs/STEP_4_5_SCENARIO_COMMITMENTS.md` for the current item model, promotion behavior, and forecast rules.

Forecast behavior remains baseline-only unless at least one selected scenario has an active scenario-only commitment for the projected account. The projection service returns the accepted scenario IDs so the UI only shows "Scenario overlay active" when an active overlay can actually contribute. Promoted scenario commitments are baseline items and are not double-counted as overlay rows.

## User Flow

1. Open `/scenarios`.
2. Create or edit scenario metadata.
3. Open the scenario detail page to add, edit, archive, or promote scenario commitments.
4. Open an account forecast page and select one or more active scenarios with active scenario-only commitments for that account.
5. Use "Clear scenarios" to return the forecast to the unchanged baseline.

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

Active scenario names are unique through a partial unique index on active scenario rows. Archived rows can keep duplicate historical names without blocking active scenario creation or restore flows.

## Smoke Coverage

`npm run test:step4-scenarios` now covers the mounted/authenticated `/scenarios` route, metadata-only create/edit/detail/archive flows, scenario item add/edit/archive, active scenario-only forecast option display, stacked overlays, archived-ID rejection, and projection immutability for transactions, statements, and accounts.

`npm run test:step4-5-scenario-commitments` covers the current Step 4.5 model, including recurring scenario commitments, promotion, baseline inclusion, no double-counting, due filtering, and register/reconciliation boundaries.

## Acceptance Criteria

- Users can create, edit, archive, and list scenarios.
- Scenario commitments can be added, edited, archived, and promoted within a scenario.
- Accounts are derived from scenario commitments.
- Forecast pages let users select multiple scenarios only when they have active scenario-only commitments for the account.
- Projection math includes scenario commitments after baseline items.
- Archived scenarios do not apply to projections.
- Baseline projection remains unchanged when no scenario is selected.
- Docs and basic automated coverage exist for the new behavior.
