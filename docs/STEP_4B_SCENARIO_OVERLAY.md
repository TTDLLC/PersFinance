# Step 4B — Scenario Overlay

> Historical note: Step 4.5 supersedes the scenario-adjustment overlay model. Forecast overlays now use scenario-scoped future commitments. See `docs/STEP_4_5_SCENARIO_COMMITMENTS.md`.

## Purpose

Step 4B adds scenario selection to the existing forecast page so users can preview stacked what-if adjustments on top of the baseline projection without changing Step 4A data model or workflow behavior.

## Scope

In scope:
- forecast query parameter handling for scenario selection
- scenario option loading per account
- merge of selected scenario adjustments into projection items
- forecast view UI for selecting and clearing scenarios

Out of scope:
- persistence of forecast results
- editing scenarios from the forecast page
- new charting or analytics

## Forecast Behavior

The forecast page now accepts multiple selected scenario IDs. When none are selected, the projection behaves as before.

When scenarios are selected:
- baseline items are unchanged
- only active scenarios linked to the selected account are accepted
- scenario adjustments for the selected account are merged on top
- scenario adjustments appear in the projection table
- warning balances and low/high summaries include scenario amounts
- archived scenario IDs are ignored, including when passed manually in query params
- Step 4.5 scenario overlays are powered by scenario-scoped future commitments. Scenario-only commitments appear only when their scenario is selected; promoted scenario commitments are included through the baseline forecast and are not double-counted as overlay rows.

## Same-Day Ordering

Same-day projection order remains unchanged from Step 3:

1. future_commitment
2. transfer
3. future_transaction
4. scenario_adjustment

This preserves the existing financial behavior while only adding scenario effects after known future items.

## Multi-Account Scoping

Only active scenarios linked to the projected account through scenario_accounts are eligible for selection. The controller loads options from that intersection, and the projection service re-checks active/account eligibility before applying any scenario adjustments.

## User Flow

1. Open an account forecast page.
2. If the account has linked scenarios, a scenario multi-select appears.
3. Select one or more scenarios and submit.
4. The page reloads with merged scenario items.
5. The page shows "Scenario overlay active" only for accepted active scenarios.
6. Clear all selected scenarios to return to baseline.

## Relationship to Other Steps

Step 4B depends on Step 4A tables and services. It does not modify register, import, transfer, or commitment behavior.

## Validation

`npm run test:forecast` preserves the Step 3 baseline forecast guarantees. `npm run test:step4-scenarios` exercises active-only selection, multi-scenario stacking, archived scenario rejection, and register/statement/account immutability.
