import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../src/db/index.js";
import {
  accounts,
  accountStatements,
  futureCommitments,
  payees,
  transactions
} from "../src/db/schema.js";
import { Accounts } from "../src/services/accounts.service.js";
import {
  enterCommitment,
  getOverdueCommitments,
  listCommitments
} from "../src/services/futureCommitments.service.js";
import {
  createTransfer,
  deleteTransfer,
  getTransfer,
  updateTransfer
} from "../src/services/transfers.service.js";
import { futureCommitmentSchema } from "../src/validation/forms.js";

const accountPrefix = "Step 2 Smoke";
const commitmentPrefix = "Step 2 Commitment";
const otherCommitmentName = "Step 2 Other Commitment";
const transferCommitmentName = "Step 2 Transfer Commitment";
const cardTransferCommitmentName = "Step 2 Card Transfer Commitment";
const endedCommitmentName = "Step 2 Ended Commitment";
const endedTransferCommitmentName = "Step 2 Ended Transfer Commitment";
const payeeNames = ["Step 2 Smoke Payee", "Step 2 Other Payee"];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const cleanup = async () => {
  await db
    .delete(futureCommitments)
    .where(inArray(futureCommitments.name, [commitmentPrefix, otherCommitmentName, transferCommitmentName, cardTransferCommitmentName, endedCommitmentName, endedTransferCommitmentName]));
  const smokeAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(inArray(accounts.name, [`${accountPrefix} Checking`, `${accountPrefix} Savings`, `${accountPrefix} Card`]));
  const smokeIds = smokeAccounts.map((row) => row.id);
  if (smokeIds.length) {
    await db.delete(transactions).where(inArray(transactions.accountId, smokeIds));
    await db.delete(accountStatements).where(inArray(accountStatements.accountId, smokeIds));
    await db.delete(accounts).where(inArray(accounts.id, smokeIds));
  }
  await db.delete(payees).where(inArray(payees.name, payeeNames));
};

const main = async () => {
  await cleanup();
  const source = await Accounts.createAccount({
    name: `${accountPrefix} Checking`,
    type: "checking",
    startingInformation: { balance: "1000.00", date: "2026-01-01" }
  });
  const destination = await Accounts.createAccount({
    name: `${accountPrefix} Savings`,
    type: "savings",
    startingInformation: { balance: "100.00", date: "2026-01-01" }
  });
  const replacement = await Accounts.createAccount({
    name: `${accountPrefix} Card`,
    type: "credit_card",
    startingInformation: { balance: "12000.00", date: "2026-01-01" }
  });
  const [smokePayee, otherPayee] = await db
    .insert(payees)
    .values(payeeNames.map((name) => ({ name })))
    .returning({ id: payees.id });

  try {
    const transferId = await createTransfer({
      date: "2026-06-01",
      amount: -125,
      sourceAccountId: source.id,
      destinationAccountId: destination.id,
      status: "entered",
      notes: "Initial transfer"
    });
    let transfer = await getTransfer(transferId);
    assert(transfer, "Transfer should create two linked rows.");
    assert(transfer.source.amount === "-125.00" && transfer.destination.amount === "125.00", "Transfer amounts should balance.");
    assert(transfer.source.description === "Transfer to Step 2 Smoke Savings", "Source description should name the destination.");
    assert(transfer.destination.description === "Transfer from Step 2 Smoke Checking", "Destination description should name the source.");
    assert(await source.getBalance() === "875.00", "Real transfer Checking to Savings should decrease checking.");
    assert(await destination.getBalance() === "225.00", "Real transfer Checking to Savings should increase savings.");

    await updateTransfer(transferId, {
      date: "2026-06-02",
      amount: -80,
      sourceAccountId: source.id,
      destinationAccountId: replacement.id,
      status: "cleared",
      notes: "Updated transfer"
    });
    transfer = await getTransfer(transferId);
    assert(transfer?.destination.accountId === replacement.id, "Editing a transfer should update the destination account.");
    assert(transfer?.source.amount === "-80.00" && transfer.destination.amount === "-80.00", "Editing to a credit card should reduce both checking and card owed balances.");
    assert(await source.getBalance() === "920.00", "Real transfer Checking to Credit Card should decrease checking.");
    assert(await replacement.getBalance() === "11920.00", "Real transfer Checking to Credit Card should decrease credit card owed balance.");

    const [statement] = await db
      .insert(accountStatements)
      .values({
        accountId: source.id,
        statementDate: "2026-06-30",
        previousStatementId: "initial",
        startingBalance: "1000.00",
        endingBalance: "920.00",
        reconciledBalance: "920.00",
        reconciled: true
      })
      .returning({ id: accountStatements.id });
    await db.update(transactions).set({ statementId: statement.id }).where(eq(transactions.id, transfer.source.id));

    let updateLocked = false;
    try {
      await updateTransfer(transferId, {
        date: "2026-06-03",
        amount: -70,
        sourceAccountId: source.id,
        destinationAccountId: replacement.id,
        status: "entered"
      });
    } catch {
      updateLocked = true;
    }
    assert(updateLocked, "A transfer should be locked when either side is reconciled.");

    let deleteLocked = false;
    try {
      await deleteTransfer(transferId);
    } catch {
      deleteLocked = true;
    }
    assert(deleteLocked, "A reconciled transfer should not be deletable.");

    const deletableTransferId = await createTransfer({
      date: "2026-06-04",
      amount: -10,
      sourceAccountId: destination.id,
      destinationAccountId: replacement.id,
      status: "entered"
    });
    await deleteTransfer(deletableTransferId);
    assert(!(await getTransfer(deletableTransferId)), "Deleting an unlocked transfer should remove both sides.");

    const [commitment] = await db
      .insert(futureCommitments)
      .values({
        name: commitmentPrefix,
        accountId: source.id,
        payeeId: smokePayee.id,
        amount: "-45.00",
        frequency: "monthly",
        nextDueDate: "2026-06-10",
        startDate: "2026-01-10",
        active: true
      })
      .returning();
    const [otherCommitment] = await db
      .insert(futureCommitments)
      .values({
        name: otherCommitmentName,
        accountId: destination.id,
        payeeId: otherPayee.id,
        amount: "-12.00",
        frequency: "monthly",
        nextDueDate: "2026-06-11",
        startDate: "2026-01-11",
        active: true
      })
      .returning();

    const payeeFiltered = await listCommitments(false, "2026-06-14", { payeeId: smokePayee.id });
    assert(payeeFiltered.some((row) => row.id === commitment.id), "Payee filter should include matching commitments.");
    assert(!payeeFiltered.some((row) => row.id === otherCommitment.id), "Payee filter should exclude non-matching commitments.");
    const accountFiltered = await listCommitments(false, "2026-06-14", { accountId: source.id });
    assert(accountFiltered.some((row) => row.id === commitment.id), "Account filter should include matching commitments.");
    assert(!accountFiltered.some((row) => row.id === otherCommitment.id), "Account filter should exclude non-matching commitments.");
    const combinedFiltered = await listCommitments(false, "2026-06-14", { payeeId: otherPayee.id, accountId: source.id });
    assert(!combinedFiltered.some((row) => row.id === commitment.id || row.id === otherCommitment.id), "Payee and account filters should combine.");

    const [transferCommitment] = await db
      .insert(futureCommitments)
      .values({
        name: transferCommitmentName,
        kind: "transfer",
        transferFromAccountId: source.id,
        transferToAccountId: destination.id,
        amount: "-65.00",
        frequency: "monthly",
        nextDueDate: "2026-06-12",
        startDate: "2026-01-12",
        active: true
      })
      .returning();
    const transferRows = await listCommitments(false, "2026-06-14");
    const listedTransfer = transferRows.find((row) => row.id === transferCommitment.id);
    assert(listedTransfer?.kind === "transfer", "List commitments should include transfer commitment kind.");
    assert(listedTransfer.transferFromAccountName === source.data.name, "Transfer commitment list should name the from account.");
    assert(listedTransfer.transferToAccountName === destination.data.name, "Transfer commitment list should name the to account.");
    const transferFromFiltered = await listCommitments(false, "2026-06-14", { accountId: source.id });
    const transferToFiltered = await listCommitments(false, "2026-06-14", { accountId: destination.id });
    assert(transferFromFiltered.some((row) => row.id === transferCommitment.id), "Account filter should match transfer from-account.");
    assert(transferToFiltered.some((row) => row.id === transferCommitment.id), "Account filter should match transfer to-account.");

    const [cardTransferCommitment] = await db
      .insert(futureCommitments)
      .values({
        name: cardTransferCommitmentName,
        kind: "transfer",
        transferFromAccountId: source.id,
        transferToAccountId: replacement.id,
        amount: "-35.00",
        frequency: "once",
        nextDueDate: "2026-06-12",
        startDate: "2026-06-12",
        endDate: "2026-06-12",
        active: true
      })
      .returning();

    const [endedCommitment] = await db
      .insert(futureCommitments)
      .values({
        name: endedCommitmentName,
        accountId: source.id,
        payeeId: smokePayee.id,
        amount: "-20.00",
        frequency: "monthly",
        nextDueDate: "2026-06-01",
        startDate: "2026-01-01",
        endDate: "2026-06-13",
        active: false
      })
      .returning();
    const [endedTransferCommitment] = await db
      .insert(futureCommitments)
      .values({
        name: endedTransferCommitmentName,
        kind: "transfer",
        transferFromAccountId: source.id,
        transferToAccountId: destination.id,
        amount: "-25.00",
        frequency: "monthly",
        nextDueDate: "2026-06-01",
        startDate: "2026-01-01",
        endDate: "2026-06-13",
        active: false
      })
      .returning();
    const activeOnlyRows = await listCommitments(false, "2026-06-14");
    const allHistoryRows = await listCommitments(true, "2026-06-14");
    assert(activeOnlyRows.some((row) => row.id === commitment.id), "Active commitment should appear in default view.");
    assert(allHistoryRows.some((row) => row.id === commitment.id), "Active commitment should appear in all-history view.");
    assert(!activeOnlyRows.some((row) => row.id === endedCommitment.id), "Ended commitment should be hidden by default.");
    assert(allHistoryRows.some((row) => row.id === endedCommitment.id), "Ended commitment should appear when showAll is true.");
    assert(!activeOnlyRows.some((row) => row.id === endedTransferCommitment.id), "Ended transfer commitment should be hidden by default.");
    assert(allHistoryRows.some((row) => row.id === endedTransferCommitment.id), "Ended transfer commitment should appear when showAll is true.");
    const activePayeeRows = await listCommitments(false, "2026-06-14", { payeeId: smokePayee.id });
    const historyPayeeRows = await listCommitments(true, "2026-06-14", { payeeId: smokePayee.id });
    assert(!activePayeeRows.some((row) => row.id === endedCommitment.id), "Payee filter default view should still hide ended commitments.");
    assert(historyPayeeRows.some((row) => row.id === endedCommitment.id), "Payee filter all-history view should include ended commitments.");
    const activeTransferAccountRows = await listCommitments(false, "2026-06-14", { accountId: destination.id });
    const historyTransferAccountRows = await listCommitments(true, "2026-06-14", { accountId: destination.id });
    assert(!activeTransferAccountRows.some((row) => row.id === endedTransferCommitment.id), "Account filter default view should hide ended transfer commitments.");
    assert(historyTransferAccountRows.some((row) => row.id === endedTransferCommitment.id), "Account filter all-history view should include ended transfer commitments.");

    const sameAccountTransfer = futureCommitmentSchema.safeParse({
      kind: "transfer",
      name: "Invalid transfer",
      transferFromAccountId: source.id,
      transferToAccountId: source.id,
      amount: "-10.00",
      frequency: "once",
      nextDueDate: "2026-06-12",
      startDate: "2026-06-12",
      endDate: "",
      active: "true"
    });
    assert(!sameAccountTransfer.success, "Same-account transfer commitments should be rejected.");

    const overdue = await getOverdueCommitments(source.id, "2026-06-14");
    assert(overdue.some((row) => row.id === commitment.id), "Due commitment detection should include assigned overdue commitments.");
    assert(overdue.some((row) => row.id === transferCommitment.id), "Due commitment detection should include matching transfer commitments.");

    const entered = await enterCommitment(commitment.id, {
      accountId: source.id,
      date: "2026-06-14",
      amount: -45,
      notes: "Confirmed by smoke test"
    });
    const [enteredTransaction] = await db.select().from(transactions).where(eq(transactions.id, entered.id));
    assert(enteredTransaction.status === "entered", "Commitment entry should create a normal entered transaction.");
    assert(enteredTransaction.description === commitmentPrefix, "Commitment entry should retain the commitment name.");

    const [advanced] = await db.select().from(futureCommitments).where(eq(futureCommitments.id, commitment.id));
    assert(advanced.nextDueDate === "2026-07-10", "Monthly commitment should advance one calendar month.");
    assert(advanced.active, "Recurring commitment should remain active after advancement.");

    const transferEntry = await enterCommitment(transferCommitment.id, {
      date: "2026-06-14",
      amount: -65,
      notes: "Transfer commitment smoke"
    });
    assert("transferId" in transferEntry, "Transfer commitment entry should return a transfer id.");
    const enteredTransferRows = await db.select().from(transactions).where(eq(transactions.transferId, transferEntry.transferId));
    assert(enteredTransferRows.length === 2, "Entering a transfer commitment should create exactly two linked rows.");
    assert(new Set(enteredTransferRows.map((row) => row.transferId)).size === 1, "Transfer commitment rows should share a transferId.");
    assert(
      enteredTransferRows.some((row) => row.accountId === source.id && row.amount === "-65.00") &&
        enteredTransferRows.some((row) => row.accountId === destination.id && row.amount === "65.00"),
      "Transfer commitment entry should create source and destination sides."
    );

    const cardTransferEntry = await enterCommitment(cardTransferCommitment.id, {
      date: "2026-06-14",
      amount: -35,
      notes: "Card payment commitment smoke"
    });
    assert("transferId" in cardTransferEntry, "Card transfer commitment entry should return a transfer id.");
    const enteredCardTransferRows = await db.select().from(transactions).where(eq(transactions.transferId, cardTransferEntry.transferId));
    assert(
      enteredCardTransferRows.some((row) => row.accountId === source.id && row.amount === "-35.00") &&
        enteredCardTransferRows.some((row) => row.accountId === replacement.id && row.amount === "-35.00"),
      "Entering a Checking to Credit Card transfer commitment should decrease checking and card owed balances."
    );

    await db
      .update(futureCommitments)
      .set({ active: false, endDate: "2026-02-01" })
      .where(eq(futureCommitments.id, commitment.id));
    const defaultRows = await listCommitments(false, "2026-06-14");
    const allRows = await listCommitments(true, "2026-06-14");
    assert(!defaultRows.some((row) => row.id === commitment.id), "Inactive commitments should be hidden by default.");
    assert(allRows.some((row) => row.id === commitment.id), "Show all should retain ended commitment history.");
  } finally {
    await cleanup();
    await pool.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
