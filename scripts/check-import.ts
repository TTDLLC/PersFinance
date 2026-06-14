import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, pool } from "../src/db/index.js";
import { accounts, accountStatements, categories, importBatches, payees, transactions } from "../src/db/schema.js";
import { Accounts } from "../src/services/accounts.service.js";
import {
  buildImportPreview,
  confirmImportPreview,
  ImportConfirmationError,
  rollbackImportBatch
} from "../src/services/transactionImport.service.js";
import { transactionSchema } from "../src/validation/forms.js";

const testAccountName = "CSV Import Smoke Account";
const testPayeeName = "CSV Import Existing Payee";
const newPayeeName = "CSV Import Created Payee";
const testCategoryName = "CSV Import Category";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const cleanup = async () => {
  const staleAccounts = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.name, testAccountName));
  const accountIds = staleAccounts.map((account) => account.id);
  if (accountIds.length) {
    await db.delete(transactions).where(inArray(transactions.accountId, accountIds));
    await db.delete(accountStatements).where(inArray(accountStatements.accountId, accountIds));
    await db.delete(importBatches).where(inArray(importBatches.accountId, accountIds));
    await db.delete(accounts).where(inArray(accounts.id, accountIds));
  }
  await db.delete(payees).where(inArray(payees.name, [testPayeeName, newPayeeName]));
  await db.delete(categories).where(eq(categories.name, testCategoryName));
};

const main = async () => {
  await cleanup();

  const account = await Accounts.createAccount({
    name: testAccountName,
    type: "checking",
    startingInformation: { balance: "100.00", date: "2026-06-01" },
    displayOrder: 999
  });
  const [existingPayee] = await db.insert(payees).values({ name: testPayeeName }).returning();
  const [category] = await db.insert(categories).values({ name: testCategoryName, type: "expense" }).returning();

  try {
    await db.insert(transactions).values({
      accountId: account.id,
      payeeId: existingPayee.id,
      date: "2026-06-02",
      amount: "-10.00",
      status: "entered"
    });

    const csv = [
      "Date,Payee,Amount,Description,Category,Memo,Reference",
      `2026-06-02,${testPayeeName},-10.00,Existing duplicate,${testCategoryName},Duplicate memo,DUP-1`,
      `2026-06-03,${testPayeeName},-25.50,Existing payee,${testCategoryName},Imported memo,REF-1`,
      `2026-06-04,${newPayeeName},50.00,New payee,,Deposit memo,REF-2`,
      `2026-06-04,${newPayeeName},50.00,CSV duplicate,,Duplicate in file,REF-3`,
      `bad-date,Missing Amount,,Invalid row,${testCategoryName},,`
    ].join("\n");

    const preview = await buildImportPreview(account.id, csv, "smoke.csv");
    assert(preview.totalRows === 5, "Preview should count all CSV data rows.");
    assert(preview.validRows === 2, "Preview should include two ready rows.");
    assert(preview.duplicateRows === 2, "Preview should detect database and within-file duplicates.");
    assert(preview.errorRows === 1, "Preview should report invalid rows.");
    assert(preview.rows[1].payeeId === existingPayee.id, "Exact existing payee should be reused.");
    assert(preview.rows[2].createsPayee, "Missing payee should be marked for creation.");
    assert(preview.rows[1].categoryId === category.id, "Exact active category should be assigned.");
    assert(transactionSchema.safeParse({
      date: "2026-06-03",
      amount: "-1.00",
      accountId: account.id,
      payeeId: existingPayee.id,
      description: "",
      categoryId: "",
      status: "entered",
      notes: ""
    }).success, "Manual validation should allow payee-only transactions.");
    assert(transactionSchema.safeParse({
      date: "2026-06-03",
      amount: "-1.00",
      accountId: account.id,
      payeeId: "",
      description: "Description only",
      categoryId: "",
      status: "entered",
      notes: ""
    }).success, "Manual validation should allow description-only transactions.");
    assert(!transactionSchema.safeParse({
      date: "2026-06-03",
      amount: "-1.00",
      accountId: account.id,
      payeeId: "",
      description: " ",
      categoryId: "",
      status: "entered",
      notes: ""
    }).success, "Manual validation should reject blank payee and description.");

    const descriptionOnlyPreview = await buildImportPreview(
      account.id,
      "Date,Amount,Description\n2026-06-07,-3.25,Description-only CSV row",
      "description-only.csv"
    );
    assert(descriptionOnlyPreview.validRows === 1, "CSV validation should allow description-only rows.");
    assert(descriptionOnlyPreview.rows[0].payeeId === null, "Description-only CSV rows should not create a payee.");

    const batch = await confirmImportPreview(preview);
    assert(batch.importedRows === 2, "Duplicates should be skipped by default.");

    const imported = await db.select().from(transactions).where(eq(transactions.importBatchId, batch.id));
    assert(imported.length === 2, "Confirmed import should create normal transactions.");
    assert(imported.every((row) => row.status === "cleared"), "Imported transactions should default to cleared.");
    assert(imported.every((row) => row.statementId === null), "Imported transactions should remain unreconciled.");
    assert(imported.some((row) => row.reference === "REF-2"), "CSV reference should be preserved.");

    const [createdPayee] = await db.select().from(payees).where(eq(payees.name, newPayeeName)).limit(1);
    assert(createdPayee?.source === "csv_import", "Import-created payee should retain source metadata.");
    assert(createdPayee.createdByImportBatchId === batch.id, "Import-created payee should reference its batch.");
    assert(await account.getBalance() === "114.50", "Balance should include imported transactions.");

    await db.insert(transactions).values({
      accountId: account.id,
      payeeId: createdPayee.id,
      date: "2026-06-05",
      amount: "-1.00",
      status: "entered",
      description: "Non-import reuse"
    });

    await rollbackImportBatch(account.id, batch.id);
    assert((await db.select().from(transactions).where(eq(transactions.importBatchId, batch.id))).length === 0, "Rollback should delete imported transactions.");
    assert((await db.select().from(payees).where(eq(payees.id, createdPayee.id))).length === 1, "Rollback should preserve an import-created payee reused elsewhere.");

    const descriptionOnlyBatch = await confirmImportPreview(descriptionOnlyPreview);
    const [descriptionOnlyTransaction] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.importBatchId, descriptionOnlyBatch.id));
    assert(descriptionOnlyTransaction?.payeeId === null, "Description-only imports should persist without a payee.");
    assert(descriptionOnlyTransaction?.description === "Description-only CSV row", "Description-only imports should preserve the description.");

    const secondPreview = await buildImportPreview(
      account.id,
      `Date,Payee,Amount\n2026-06-06,${testPayeeName},20.00`,
      "reconcile-lock.csv"
    );
    const secondBatch = await confirmImportPreview(secondPreview);
    const [secondTransaction] = await db.select().from(transactions).where(eq(transactions.importBatchId, secondBatch.id));
    const currentAccount = await Accounts.getAccount(account.id);
    assert(currentAccount, "Account should reload.");
    const currentBalance = await currentAccount.getBalance();
    await currentAccount.reconcileStatement({
      statementDate: "2026-06-30",
      endingBalance: Number(currentBalance),
      selectedTransactionIds: (
        await db
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(eq(transactions.accountId, account.id), isNull(transactions.statementId)))
      ).map((row) => row.id)
    });

    assert(secondTransaction, "Second import should create a transaction.");
    let rollbackRefused = false;
    try {
      await rollbackImportBatch(account.id, secondBatch.id);
    } catch {
      rollbackRefused = true;
    }
    assert(rollbackRefused, "Rollback should be refused after an imported transaction is reconciled.");

    const rollbackCsv = ["Date,Amount,Description"];
    for (let index = 0; index < 501; index += 1) {
      rollbackCsv.push(`2030-01-01,-1.00,Rollback row ${index + 1}`);
    }
    const rollbackPreview = await buildImportPreview(account.id, rollbackCsv.join("\n"), "chunk-rollback.csv");
    rollbackPreview.rows[500].description = null;
    const batchesBeforeFailure = await db
      .select({ id: importBatches.id })
      .from(importBatches)
      .where(eq(importBatches.accountId, account.id));
    let chunkFailure: unknown;
    try {
      await confirmImportPreview(rollbackPreview);
    } catch (error) {
      chunkFailure = error;
    }
    assert(
      chunkFailure instanceof ImportConfirmationError && chunkFailure.phase === "transaction creation",
      "A later chunk failure should report the transaction creation phase."
    );
    const batchesAfterFailure = await db
      .select({ id: importBatches.id })
      .from(importBatches)
      .where(eq(importBatches.accountId, account.id));
    assert(
      batchesAfterFailure.length === batchesBeforeFailure.length,
      "A later chunk failure should roll back the import batch and all earlier chunks."
    );
  } finally {
    await cleanup();
    await pool.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
