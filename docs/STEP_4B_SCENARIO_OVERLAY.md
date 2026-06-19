# Step 4B — Scenario Overlay

> Historical note: Step 4.5 supersedes the scenario-adjustment overlay model. Forecast overlays now use active scenario-only future commitments. Promoted scenario commitments are baseline items and are not double-counted. See `docs/STEP_4_5_SCENARIO_COMMITMENTS.md`.

## Purpose

Step 4B added scenario selection to the existing forecast page so users could preview stacked what-if adjustments on top of the baseline projection without changing the original Step 4A data model or workflow behavior.

## Scope

Historical scope:
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

Current Step 4.5 behavior when scenarios are selected:
- baseline items are unchanged
- only active scenarios with active scenario-only commitments for the selected account are accepted
- scenario commitments for the selected account are merged on top
- scenario commitments appear in the projection table
- warning balances and low/high summaries include scenario amounts
- archived scenario IDs are ignored, including when passed manually in query params
- promoted scenario commitments are included through the baseline forecast and are not double-counted as overlay rows

## Same-Day Ordering

Same-day projection order remains unchanged from Step 3:

1. future_commitment
2. transfer
3. future_transaction
4. scenario_commitment

This preserves the existing financial behavior while only adding scenario effects after known future items.

## Multi-Account Scoping

Only active scenarios with at least one active scenario-only commitment for the projected account are eligible for selection. Legacy `scenario_accounts` links do not make a scenario selectable by themselves. The controller loads options from that commitment-backed intersection, and the projection service re-checks eligibility before applying overlay items.

## User Flow

1. Open an account forecast page.
2. If the account has eligible scenario-only commitments, a scenario multi-select appears.
3. Select one or more scenarios and submit.
4. The page reloads with merged scenario commitment items.
5. The page shows "Scenario overlay active" only for accepted active scenarios.
6. Clear all selected scenarios to return to baseline.

## Relationship to Other Steps

Step 4B historically depended on Step 4A tables and services. Current behavior depends on Step 4.5 scenario commitments. It does not modify register, import, transfer, or commitment entry behavior.

## Validation

`npm run test:forecast` preserves the Step 3 baseline forecast guarantees. `npm run test:step4-scenarios` exercises active-only selection, multi-scenario stacking, archived scenario rejection, and register/statement/account immutability.
