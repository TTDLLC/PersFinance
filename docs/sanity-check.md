# PersFinance v1.0.0-internal Manual Verification

## 1. Account creation

- Create checking account with starting balance 1000.00 and start date 2026-01-31.
- Confirm dashboard Current Balance shows 1000.00.
- Confirm reconciliation display/date uses the start date.
- Confirm no initial synthetic statement appears in statement history.

## 2. Active register balance

Add:
- Paycheck +1500.00
- Grocery -75.00
- Electric -150.00

Expected Current Balance:

1000.00 + 1500.00 - 75.00 - 150.00 = 2275.00

Confirm dashboard and account register show the same Current Balance.

## 3. Void behavior

- Void the Grocery transaction.
- Confirm Current Balance becomes 2350.00.
- Confirm active register excludes void.
- Confirm show all excludes void.
- Confirm void view shows the grocery transaction.

## 4. Reconciliation preview failure

Try reconciling selected transactions with an incorrect ending balance.

Expected:
- Reconciliation fails / difference shown.
- No transaction receives statementId.
- No transaction disappears from active register.
- Account statement_chain_balance remains unchanged.

## 5. Successful reconciliation

Reconcile Paycheck and Electric with ending balance:

1000.00 + 1500.00 - 150.00 = 2350.00

Expected:
- Selected transactions get statementId.
- Selected transactions status becomes cleared.
- Statement is marked reconciled.
- statement_chain_balance becomes 2350.00.
- Active register is now empty.
- Current Balance remains 2350.00.
- Statement detail shows Paycheck and Electric.

## 6. Post-reconciliation activity

Add new transaction:
- Gas -40.00

Expected Current Balance:

2350.00 - 40.00 = 2310.00

Confirm dashboard and register agree.