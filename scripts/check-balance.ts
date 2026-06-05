import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../src/db/index.js";
import { accounts, accountStatements, categories, payees, transactions } from "../src/db/schema.js";
import { Accounts } from "../src/services/accounts.service.js";

const testAccountName = "Current Balance Smoke Account";
const testPayeeName = "Current Balance Smoke Payee";
const testCategoryName = "Current Balance Smoke Category";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const cleanup = async () => {
  const staleAccounts = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.name, testAccountName));
  const accountIds = staleAccounts.map((account) => account.id);
  if (accountIds.length) {
    await db.delete(transactions).where(inArray(transactions.accountId, accountIds));
    await db.delete(accountStatements).where(inArray(accountStatements.accountId, accountIds));
    await db.delete(accounts).where(inArray(accounts.id, accountIds));
  }
  await db.delete(payees).where(eq(payees.name, testPayeeName));
  await db.delete(categories).where(eq(categories.name, testCategoryName));
};

const main = async () => {
  await cleanup();

  const account = await Accounts.createAccount({
    name: testAccountName,
    type: "checking",
    startingInformation: {
      balance: "1000.00",
      date: "2026-06-01",
      notes: "Known starting point"
    },
    displayOrder: 999
  });

  const [payee] = await db.insert(payees).values({ name: testPayeeName }).returning({ id: payees.id });
  const [category] = await db.insert(categories).values({ name: testCategoryName, type: "expense" }).returning({ id: categories.id });

  try {
    assert(account.data.statementChainBalance === "1000.00", "Account creation should initialize statement-chain balance.");
    assert(account.data.lastReconciledStatementId === null, "Account creation should not create or reference an initial statement.");
    assert(await account.getBalance() === "1000.00", "Current Balance with no transactions should equal statement-chain balance.");

    await db.insert(transactions).values([
      { accountId: account.id, payeeId: payee.id, categoryId: category.id, date: "2026-06-02", amount: "-100.00", status: "entered" },
      { accountId: account.id, payeeId: payee.id, categoryId: category.id, date: "2026-06-03", amount: "-50.00", status: "pending" },
      { accountId: account.id, payeeId: payee.id, categoryId: category.id, date: "2026-06-04", amount: "200.00", status: "cleared" },
      { accountId: account.id, payeeId: payee.id, categoryId: category.id, date: "2026-06-05", amount: "-500.00", status: "void" }
    ]);

    const details = await account.getBalance({ extended: true });
    assert(details.currentBalance === "1050.00", "Current Balance should include active entered/pending/cleared transactions and exclude void.");
    assert(details.statementBalance === "1000.00", "Extended balance should expose statement-chain balance.");
    assert(details.activeTransactionTotal === "50.00", "Extended balance should expose active transaction total.");

    const debtAccount = await Accounts.createAccount({
      name: `${testAccountName} Credit Card`,
      type: "credit_card",
      startingInformation: { balance: "250.00", date: "2026-06-01" },
      displayOrder: 1000
    });
    assert(await debtAccount.getBalance() === "250.00", "Debt account balances should display positive in normal UI.");
  } finally {
    await cleanup();
    await db.delete(accounts).where(eq(accounts.name, `${testAccountName} Credit Card`));
    await pool.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
