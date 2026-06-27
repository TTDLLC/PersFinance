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

const accountPrefix = "Step 2 Smoke";
const commitmentPrefix = "Step 2 Commitment";
const otherCommitmentName = "Step 2 Other Commitment";
const payeeNames = ["Step 2 Smoke Payee", "Step 2 Other Payee"];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const cleanup = async () => {
  await db.delete(futureCommitments).where(inArray(futureCommitments.name, [commitmentPrefix, otherCommitmentName]));
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
    startingInformation: { balance: "0.00", date: "2026-01-01" }
  });
  const [smokePayee, otherPayee] = await db
    .insert(payees)
    .values(payeeNames.map((name) => ({ name })))
    .returning({ id: payees.id });

  try {
    const transferId = await createTransfer({
      date: "2026-06-01",
      amount: 125,
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

    await updateTransfer(transferId, {
      date: "2026-06-02",
      amount: 80,
      sourceAccountId: source.id,
      destinationAccountId: replacement.id,
      status: "cleared",
      notes: "Updated transfer"
    });
    transfer = await getTransfer(transferId);
    assert(transfer?.destination.accountId === replacement.id, "Editing a transfer should update the destination account.");
    assert(transfer?.source.amount === "-80.00" && transfer.destination.amount === "80.00", "Editing should update both amounts.");

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
        amount: 70,
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
      amount: 10,
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

    const overdue = await getOverdueCommitments(source.id, "2026-06-14");
    assert(overdue.some((row) => row.id === commitment.id), "Due commitment detection should include assigned overdue commitments.");

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

    await db
      .update(futureCommitments)
      .set({ active: false, endDate: "2026-02-01" })
      .where(eq(futureCommitments.id, commitment.id));
    const defaultRows = await listCommitments(false, "2026-06-14");
    const allRows = await listCommitments(true, "2026-06-14");
    assert(!defaultRows.some((row) => row.id === commitment.id), "Commitments ended over 60 days ago should be hidden by default.");
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
