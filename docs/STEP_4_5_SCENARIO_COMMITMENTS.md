# Step 4.5 - Scenario Commitments

Step 4.5 replaces the separate scenario-adjustment planning engine with commitment-backed scenario items.

## Option C Model

`future_commitments` is now the shared scheduled-item table for baseline commitments and scenario commitments.

New fields:

- `scenario_id`: nullable FK to `scenarios`.
- `include_in_baseline`: boolean, not null, default `true`.

Meanings:

- `scenario_id = null`, `include_in_baseline = true`: normal baseline Future Commitment.
- `scenario_id = <scenario>`, `include_in_baseline = false`: scenario-only hypothetical commitment.
- `scenario_id = <scenario>`, `include_in_baseline = true`: promoted scenario commitment that remains linked to the scenario and participates in baseline planning.

## Forecast Rules

Baseline projections include active commitments where `include_in_baseline = true`.

Scenario overlays include active commitments where:

- `scenario_id` is one of the selected active scenarios.
- `include_in_baseline = false`.

Promoted scenario commitments are intentionally excluded from overlay items because they are already in the baseline projection.

Same-day projection order remains:

1. Future commitment
2. Transfer
3. Future transaction
4. Scenario commitment

## UI Behavior

Scenarios are metadata containers. Creating a scenario no longer requires selecting accounts.

Scenario detail is the planning workspace:

- linked account summary is derived from scenario items
- scenario items show account, amount, frequency, dates, payee, category, notes, and active state
- item status is shown as `Scenario Only` or `Included in Baseline`
- scenario-only items can be promoted individually

Future Commitments remains the baseline workflow. It shows normal baseline commitments and promoted scenario commitments. Scenario-only commitments are hidden from that list. Promoted rows show a simple scenario badge.

## Promotion

Promotion sets `include_in_baseline = true` on the existing row.

It does not:

- duplicate the commitment
- clear `scenario_id`
- create a register transaction
- mutate account balances, statements, reconciliation, or transactions

After promotion, the item remains visible on the scenario detail page and appears in baseline Future Commitment workflows and forecasts.

## Unpromotion

Unpromotion is parked for this pass.

There is not yet a reliable commitment-to-transaction linkage that can prove whether a promoted commitment has produced cleared or reconciled accounting activity. Adding unpromotion without that guardrail could make baseline history misleading.

## Migration

Migration `0004_step_4_5_scenario_commitments.sql` adds the new columns and indexes.

Existing `scenario_adjustments` rows are copied into `future_commitments` as one-time scenario-only commitments:

- `scenario_id` copied from the adjustment
- `include_in_baseline = false`
- `account_id`, `amount`, `payee_id`, `category_id`, notes copied
- `name` uses the adjustment description, falling back to `Scenario adjustment`
- `frequency = once`
- `next_due_date`, `start_date`, and `end_date` use the adjustment date

The legacy `scenario_adjustments` table is not dropped in this pass, so existing data remains available for audit or rollback.

## Boundaries

Scenario-only commitments do not appear in the register and do not create transactions. They do not affect account balances, statements, or reconciliation.

Promoted scenario commitments become baseline planning items, but still only create real register activity through the existing Future Commitment entry workflow.
