import { eq, inArray } from "drizzle-orm";
import { performance } from "node:perf_hooks";
import { db, pool } from "../src/db/index.js";
import { accounts, accountStatements, importBatches, payees, transactions } from "../src/db/schema.js";
import { Accounts } from "../src/services/accounts.service.js";
import { getAccountRegister } from "../src/services/accountRegister.service.js";
import {
  buildImportPreview,
  confirmImportPreview,
  rollbackImportBatch
} from "../src/services/transactionImport.service.js";

const rowCount = Number(process.env.LARGE_IMPORT_ROWS ?? 12000);
const testAccountName = "Large CSV Validation Account";
const payeePrefix = "Large CSV Payee ";

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
  const generatedPayees = await db
    .select({ id: payees.id })
    .from(payees)
    .where(inArray(payees.name, Array.from({ length: 25 }, (_, index) => `${payeePrefix}${index + 1}`)));
  if (generatedPayees.length) await db.delete(payees).where(inArray(payees.id, generatedPayees.map((payee) => payee.id)));
};

const makeCsv = () => {
  const rows = ["Date,Payee,Amount,Description,Reference"];
  for (let index = 0; index < rowCount; index += 1) {
    const date = new Date(Date.UTC(2026, 4, 1 + index)).toISOString().slice(0, 10);
    const amount = index % 2 === 0 ? "1.25" : "-0.75";
    rows.push(`${date},${payeePrefix}${(index % 25) + 1},${amount},Generated row ${index + 1},LARGE-${index + 1}`);
  }
  return rows.join("\n");
};

const main = async () => {
  assert(Number.isInteger(rowCount) && rowCount > 0, "LARGE_IMPORT_ROWS must be a positive integer.");
  await cleanup();

  const account = await Accounts.createAccount({
    name: testAccountName,
    type: "checking",
    startingInformation: { balance: "1000.00", date: "2026-05-01" },
    displayOrder: 999
  });

  try {
    const memoryBefore = process.memoryUsage().heapUsed;
    const previewStarted = performance.now();
    const preview = await buildImportPreview(account.id, makeCsv(), `generated-${rowCount}.csv`);
    const previewMs = performance.now() - previewStarted;
    assert(preview.validRows === rowCount, "Every generated row should be ready to import.");

    const importStarted = performance.now();
    const batch = await confirmImportPreview(preview);
    const importMs = performance.now() - importStarted;
    assert(batch.importedRows === rowCount, "Large import should create every generated transaction.");

    const registerStarted = performance.now();
    const register = await getAccountRegister(account.id);
    const registerMs = performance.now() - registerStarted;
    const memoryAfterRegister = process.memoryUsage().heapUsed;
    assert(register?.rows.length === rowCount, "Register should load every imported transaction.");

    const expectedDelta = Math.ceil(rowCount / 2) * 1.25 - Math.floor(rowCount / 2) * 0.75;
    const expectedBalance = (1000 + expectedDelta).toFixed(2);
    assert(await account.getBalance() === expectedBalance, "Large import balance should be exact.");

    const transactionIds = register.rows.map((row) => row.id);
    await account.reconcileStatement({
      statementDate: "2040-12-31",
      endingBalance: Number(expectedBalance),
      selectedTransactionIds: transactionIds
    });

    let rollbackRefused = false;
    try {
      await rollbackImportBatch(account.id, batch.id);
    } catch {
      rollbackRefused = true;
    }
    assert(rollbackRefused, "Reconciled large import should not be eligible for rollback.");

    console.log([
      `Validated ${rowCount} rows.`,
      `Preview: ${previewMs.toFixed(0)}ms.`,
      `Import: ${importMs.toFixed(0)}ms.`,
      `Register load: ${registerMs.toFixed(0)}ms.`,
      `Heap change through register: ${((memoryAfterRegister - memoryBefore) / 1024 / 1024).toFixed(1)} MiB.`
    ].join(" "));
  } finally {
    await cleanup();
    await pool.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
