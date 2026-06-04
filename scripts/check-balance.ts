import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../src/db/index.js";
import { accountBalanceSnapshots, accounts, transactions } from "../src/db/schema.js";
import { getAccountWorkingBalance } from "../src/services/balance.service.js";

const testAccountName = "Manual Balance Test Account";
const snapshotDate = "2026-01-31";
const transactionDate = "2026-02-01";

const assertBalance = (actual: number | undefined, expected: number, label: string) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${actual ?? "missing"}.`);
  }
};

const main = async () => {
  const existingAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.name, testAccountName));
  const staleAccountIds = existingAccounts.map((account) => account.id);

  if (staleAccountIds.length) {
    await db.delete(transactions).where(inArray(transactions.accountId, staleAccountIds));
    await db.delete(accountBalanceSnapshots).where(inArray(accountBalanceSnapshots.accountId, staleAccountIds));
    await db.delete(accounts).where(inArray(accounts.id, staleAccountIds));
  }

  const [account] = await db
    .insert(accounts)
    .values({
      name: testAccountName,
      type: "checking",
      startingBalance: "0.00",
      currentBalance: "0.00",
      displayOrder: 999
    })
    .returning({ id: accounts.id });

  try {
    await db.insert(accountBalanceSnapshots).values({
      accountId: account.id,
      snapshotDate,
      balance: "1000.00",
      source: "manual-balance-test"
    });

    await db.insert(transactions).values([
      { accountId: account.id, date: transactionDate, description: "Entered test", amount: "-100.00", status: "entered" },
      { accountId: account.id, date: transactionDate, description: "Pending test", amount: "-50.00", status: "pending" },
      { accountId: account.id, date: transactionDate, description: "Cleared test", amount: "200.00", status: "cleared" },
      { accountId: account.id, date: transactionDate, description: "Void test", amount: "-500.00", status: "void" },
      { accountId: account.id, date: transactionDate, description: "Recurring test", amount: "-75.00", status: "recurring" },
      { accountId: account.id, date: transactionDate, description: "Statement test", amount: "-25.00", status: "statement" }
    ]);

    const baseBalance = await getAccountWorkingBalance(account.id);
    assertBalance(baseBalance?.workingBalance, 975, "Working balance includes recurring and excludes statement/void.");

    console.log("Manual balance check passed: 1000 - 100 - 50 + 200 - 75 = 975; statement and void are excluded.");
  } finally {
    await db.delete(transactions).where(eq(transactions.accountId, account.id));
    await db.delete(accountBalanceSnapshots).where(eq(accountBalanceSnapshots.accountId, account.id));
    await db.delete(accounts).where(eq(accounts.id, account.id));
    await pool.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
