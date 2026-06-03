import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { app } from "../src/app.js";
import { completeAccountReconciliation } from "../src/controllers/accountStatements.controller.js";
import { db, pool } from "../src/db/index.js";
import { accountBalanceSnapshots, accounts, accountStatements, categories, transactions, users } from "../src/db/schema.js";
import { getAccountRegister, isBalanceAffectingRegisterStatus } from "../src/services/accountRegister.service.js";
import {
  calculateNextRecurringDate,
  processDueRecurringTransactions,
  updateRecurringTransactionWithLifecycle,
  voidRecurringTransactionWithLifecycle
} from "../src/services/recurring.service.js";

const testAccountName = "Register Flow Test Account";
const testCategoryName = "Register Flow Test Category";
const testUserEmail = "register-flow-test@example.com";
const testPassword = "register-flow-password";
const today = "2026-06-03";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const assertDescriptions = (actual: string[], expected: string[], label: string) => {
  const missing = expected.filter((description) => !actual.includes(description));
  assert(!missing.length, `${label}: missing ${missing.join(", ")}`);
};

const assertNotDescriptions = (actual: string[], unexpected: string[], label: string) => {
  const found = unexpected.filter((description) => actual.includes(description));
  assert(!found.length, `${label}: unexpectedly found ${found.join(", ")}`);
};

const assertTextIncludes = (actual: string, expected: string[], label: string) => {
  const missing = expected.filter((text) => !actual.includes(text));
  assert(!missing.length, `${label}: missing ${missing.join(", ")}`);
};

const assertTextExcludes = (actual: string, unexpected: string[], label: string) => {
  const found = unexpected.filter((text) => actual.includes(text));
  assert(!found.length, `${label}: unexpectedly found ${found.join(", ")}`);
};

const assertTransactionCount = async (recurringGroupId: string, date: string, status: "entered" | "recurring" | "void", expected: number) => {
  const rows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.recurringGroupId, recurringGroupId), eq(transactions.date, date), eq(transactions.status, status)));
  assert(rows.length === expected, `Expected ${expected} ${status} transaction(s) for recurring group ${recurringGroupId} on ${date}; found ${rows.length}.`);
};

const insertRecurringOccurrence = async (
  accountId: string,
  categoryId: string,
  values: Partial<typeof transactions.$inferInsert> & { date: string; description: string; recurringGroupId?: string }
) => {
  const [transaction] = await db
    .insert(transactions)
    .values({
      accountId,
      categoryId,
      date: values.date,
      description: values.description,
      amount: values.amount ?? "-10.00",
      status: values.status ?? "recurring",
      amountType: values.amountType ?? "fixed",
      paymentMethod: values.paymentMethod ?? "manual",
      recurringGroupId: values.recurringGroupId ?? randomUUID(),
      frequency: values.frequency ?? "monthly",
      recurringEndDate: values.recurringEndDate,
      dayOfMonth: values.dayOfMonth,
      transactionType: values.transactionType,
      notes: values.notes
    })
    .returning();
  return transaction;
};

const cleanup = async () => {
  const staleAccounts = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.name, testAccountName));
  const staleAccountIds = staleAccounts.map((account) => account.id);
  if (staleAccountIds.length) {
    await db.delete(transactions).where(inArray(transactions.accountId, staleAccountIds));
    await db.delete(accountBalanceSnapshots).where(inArray(accountBalanceSnapshots.accountId, staleAccountIds));
    await db.delete(accountStatements).where(inArray(accountStatements.accountId, staleAccountIds));
    await db.delete(accounts).where(inArray(accounts.id, staleAccountIds));
  }
  await db.delete(categories).where(eq(categories.name, testCategoryName));
  await db.delete(users).where(eq(users.email, testUserEmail));
};

const startServer = () =>
  new Promise<{ close: () => Promise<void>; baseUrl: string }>((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Could not start test server.");
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((closeResolve) => server.close(() => closeResolve()))
      });
    });
  });

const main = async () => {
  await cleanup();

  const [account] = await db
    .insert(accounts)
    .values({
      name: testAccountName,
      type: "checking",
      startingBalance: "0.00",
      currentBalance: "0.00",
      includeInProjection: false,
      displayOrder: 999
    })
    .returning({ id: accounts.id });

  const [category] = await db
    .insert(categories)
    .values({ name: testCategoryName, type: "expense", displayOrder: 999 })
    .returning({ id: categories.id });

  const passwordHash = await bcrypt.hash(testPassword, 4);
  await db.insert(users).values({
    email: testUserEmail,
    passwordHash,
    displayName: "Register Test"
  });

  try {
    await db.insert(accountBalanceSnapshots).values([
      { accountId: account.id, snapshotDate: "2026-05-15", balance: "500.00", source: "register-test-old" },
      { accountId: account.id, snapshotDate: "2026-05-31", balance: "1000.00", source: "register-test-latest" }
    ]);

    await db.insert(transactions).values([
      { accountId: account.id, categoryId: category.id, date: "2026-05-20", description: "Before latest snapshot", amount: "-999.00", status: "cleared" },
      { accountId: account.id, categoryId: category.id, date: "2026-06-01", description: "Statement hidden", amount: "-25.00", status: "statement" },
      { accountId: account.id, categoryId: category.id, date: "2026-06-01", description: "Void hidden", amount: "-40.00", status: "void" },
      { accountId: account.id, categoryId: category.id, date: "2026-06-01", description: "Entered expense", amount: "-100.00", status: "entered" },
      { accountId: account.id, categoryId: category.id, date: "2026-06-02", description: "Pending expense", amount: "-50.00", status: "pending" },
      { accountId: account.id, categoryId: category.id, date: "2026-06-03", description: "Cleared deposit", amount: "200.00", status: "cleared" },
      { accountId: account.id, categoryId: category.id, date: "2026-06-10", description: "Recurring future", amount: "-75.00", status: "recurring" },
      { accountId: account.id, categoryId: category.id, date: "2026-07-15", description: "Future within window", amount: "-30.00", status: "entered" },
      { accountId: account.id, categoryId: category.id, date: "2026-08-05", description: "Future beyond window", amount: "-60.00", status: "entered" }
    ]);

    const defaultRegister = await getAccountRegister(account.id, { today });
    if (!defaultRegister) throw new Error("Expected account register to load for valid account.");
    const defaultDescriptions = defaultRegister.rows.map((row) => row.description);
    assertDescriptions(defaultDescriptions, ["Entered expense", "Pending expense", "Cleared deposit", "Recurring future", "Future within window"], "Default register rows");
    assertNotDescriptions(defaultDescriptions, ["Before latest snapshot", "Statement hidden", "Void hidden", "Future beyond window"], "Default register rows");
    assert(defaultRegister.latestSnapshotBalance === 1000, "Running balance should start from latest snapshot.");
    assert(defaultRegister.rows.at(-1)?.balanceAfter === 945, "Running balance should include entered/pending/cleared/recurring and exclude statement/void.");

    const noFutureRegister = await getAccountRegister(account.id, { today, showFuture: false });
    assertNotDescriptions(noFutureRegister?.rows.map((row) => row.description) ?? [], ["Recurring future", "Future within window"], "showFuture=false register rows");

    const showVoidRegister = await getAccountRegister(account.id, { today, showVoid: true });
    if (!showVoidRegister) throw new Error("Expected showVoid register to load for valid account.");
    const voidRow = showVoidRegister.rows.find((row) => row.description === "Void hidden");
    if (!voidRow) throw new Error("Voided transactions should be visible when showVoid=true.");
    let expectedShowVoidBalance = showVoidRegister.latestSnapshotBalance;
    for (const row of showVoidRegister.rows) {
      if (isBalanceAffectingRegisterStatus(row.status)) expectedShowVoidBalance += row.amount;
      assert(row.balanceAfter === expectedShowVoidBalance, `${row.description} should not include excluded transaction amounts in running balance.`);
    }
    assert(showVoidRegister.rows.at(-1)?.balanceAfter === defaultRegister.rows.at(-1)?.balanceAfter, "Showing void rows should not change the ending running balance.");

    assert(
      calculateNextRecurringDate({ date: "2026-01-01", frequency: "weekly", dayOfMonth: null }) === "2026-01-08",
      "Weekly frequency should generate one week later."
    );
    assert(
      calculateNextRecurringDate({ date: "2026-01-01", frequency: "biweekly", dayOfMonth: null }) === "2026-01-15",
      "Biweekly frequency should generate two weeks later."
    );
    assert(
      calculateNextRecurringDate({ date: "2026-01-31", frequency: "monthly", dayOfMonth: 31 }) === "2026-02-28",
      "Monthly frequency should generate one month later with day clamping."
    );
    assert(
      calculateNextRecurringDate({ date: "2026-01-31", frequency: "quarterly", dayOfMonth: 31 }) === "2026-04-30",
      "Quarterly frequency should generate three months later with day clamping."
    );
    assert(
      calculateNextRecurringDate({ date: "2026-02-28", frequency: "yearly", dayOfMonth: 28 }) === "2027-02-28",
      "Yearly frequency should generate one year later."
    );

    const dueGroupId = randomUUID();
    await insertRecurringOccurrence(account.id, category.id, {
      date: "2026-01-15",
      description: "Netflix recurring",
      recurringGroupId: dueGroupId,
      dayOfMonth: 15
    });
    const processed = await processDueRecurringTransactions(account.id, "2026-01-16");
    assert(processed === 1, "Due recurring processing should process the due transaction.");
    await assertTransactionCount(dueGroupId, "2026-01-15", "entered", 1);
    await assertTransactionCount(dueGroupId, "2026-02-15", "recurring", 1);

    const endDateGroupId = randomUUID();
    await insertRecurringOccurrence(account.id, category.id, {
      date: "2026-01-31",
      description: "Ended recurring",
      recurringGroupId: endDateGroupId,
      recurringEndDate: "2026-02-27",
      dayOfMonth: 31
    });
    await processDueRecurringTransactions(account.id, "2026-01-31");
    await assertTransactionCount(endDateGroupId, "2026-01-31", "entered", 1);
    await assertTransactionCount(endDateGroupId, "2026-02-28", "recurring", 0);

    const duplicateGroupId = randomUUID();
    await insertRecurringOccurrence(account.id, category.id, {
      date: "2026-03-15",
      description: "Duplicate source recurring",
      recurringGroupId: duplicateGroupId,
      dayOfMonth: 15
    });
    await insertRecurringOccurrence(account.id, category.id, {
      date: "2026-04-15",
      description: "Duplicate existing recurring",
      recurringGroupId: duplicateGroupId,
      dayOfMonth: 15
    });
    await processDueRecurringTransactions(account.id, "2026-03-16");
    await processDueRecurringTransactions(account.id, "2026-03-16");
    await assertTransactionCount(duplicateGroupId, "2026-03-15", "entered", 1);
    await assertTransactionCount(duplicateGroupId, "2026-04-15", "recurring", 1);

    const voidGroupId = randomUUID();
    const voidSource = await insertRecurringOccurrence(account.id, category.id, {
      date: "2026-05-01",
      description: "Gym Membership",
      recurringGroupId: voidGroupId,
      dayOfMonth: 1
    });
    await voidRecurringTransactionWithLifecycle(voidSource);
    await assertTransactionCount(voidGroupId, "2026-05-01", "void", 1);
    await assertTransactionCount(voidGroupId, "2026-06-01", "recurring", 1);

    const futureEditGroupId = randomUUID();
    const historicalEdit = await insertRecurringOccurrence(account.id, category.id, {
      date: "2026-01-01",
      description: "Historical original",
      recurringGroupId: futureEditGroupId,
      status: "entered",
      amount: "-20.00",
      dayOfMonth: 1
    });
    const selectedFutureEdit = await insertRecurringOccurrence(account.id, category.id, {
      date: "2026-02-01",
      description: "Selected original",
      recurringGroupId: futureEditGroupId,
      amount: "-20.00",
      dayOfMonth: 1
    });
    const laterFutureEdit = await insertRecurringOccurrence(account.id, category.id, {
      date: "2026-03-01",
      description: "Later original",
      recurringGroupId: futureEditGroupId,
      amount: "-20.00",
      dayOfMonth: 1
    });
    await updateRecurringTransactionWithLifecycle(
      selectedFutureEdit,
      { description: "Changed future series", amount: "-25.00" },
      "future"
    );
    const [historicalAfterFutureEdit] = await db.select().from(transactions).where(eq(transactions.id, historicalEdit.id)).limit(1);
    const [selectedAfterFutureEdit] = await db.select().from(transactions).where(eq(transactions.id, selectedFutureEdit.id)).limit(1);
    const [laterAfterFutureEdit] = await db.select().from(transactions).where(eq(transactions.id, laterFutureEdit.id)).limit(1);
    assert(historicalAfterFutureEdit.description === "Historical original", "This-and-future edits must not modify historical transactions.");
    assert(selectedAfterFutureEdit.description === "Changed future series", "This-and-future edits should update the selected occurrence.");
    assert(laterAfterFutureEdit.description === "Changed future series", "This-and-future edits should update future recurring occurrences.");

    const thisOnlyGroupId = randomUUID();
    const thisOnlySelected = await insertRecurringOccurrence(account.id, category.id, {
      date: "2026-08-01",
      description: "This only selected",
      recurringGroupId: thisOnlyGroupId,
      dayOfMonth: 1
    });
    const thisOnlyFuture = await insertRecurringOccurrence(account.id, category.id, {
      date: "2026-09-01",
      description: "This only future",
      recurringGroupId: thisOnlyGroupId,
      dayOfMonth: 1
    });
    await updateRecurringTransactionWithLifecycle(thisOnlySelected, { description: "This only changed" }, "this");
    const [thisOnlySelectedAfter] = await db.select().from(transactions).where(eq(transactions.id, thisOnlySelected.id)).limit(1);
    const [thisOnlyFutureAfter] = await db.select().from(transactions).where(eq(transactions.id, thisOnlyFuture.id)).limit(1);
    assert(thisOnlySelectedAfter.description === "This only changed", "This transaction only edits should update the selected occurrence.");
    assert(thisOnlyFutureAfter.description === "This only future", "This transaction only edits must not update future occurrences.");

    assert(
      processDueRecurringTransactions.toString().includes("db.transaction"),
      "Recurring processing should remain wrapped in a database transaction."
    );

    const server = await startServer();
    try {
      const loginResponse = await fetch(`${server.baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email: testUserEmail, password: testPassword }),
        redirect: "manual"
      });
      const cookie = loginResponse.headers.get("set-cookie")?.split(";")[0];
      if (!cookie) throw new Error("Expected login to set a session cookie.");

      const routeDueGroupId = randomUUID();
      await insertRecurringOccurrence(account.id, category.id, {
        date: "2026-06-02",
        description: "Route due recurring",
        recurringGroupId: routeDueGroupId,
        dayOfMonth: 2
      });
      const registerResponse = await fetch(`${server.baseUrl}/accounts/${account.id}/register`, {
        headers: { Cookie: cookie }
      });
      const html = await registerResponse.text();
      assert(registerResponse.status === 200, "Account register route should load for a valid account.");
      await assertTransactionCount(routeDueGroupId, "2026-06-02", "entered", 1);
      await assertTransactionCount(routeDueGroupId, "2026-07-02", "recurring", 1);
      assert(html.includes("Register Flow Test Account Register"), "Register route should render the account register.");
      assert(html.includes("($50.00)"), "Negative amounts should display with parentheses.");
      assert(html.includes("future-row"), "Future rows should render with the future-row CSS class.");

      const [activeTransaction] = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.description, "Entered expense"))
        .limit(1);
      const voidResponse = await fetch(`${server.baseUrl}/accounts/${account.id}/register/${activeTransaction.id}/void`, {
        method: "POST",
        headers: { Cookie: cookie },
        redirect: "manual"
      });
      assert(voidResponse.status === 302, "Active transactions can be voided.");
      const afterVoid = await getAccountRegister(account.id, { today });
      assertNotDescriptions(afterVoid?.rows.map((row) => row.description) ?? [], ["Entered expense"], "After void default rows");
      const afterVoidVisible = await getAccountRegister(account.id, { today, showVoid: true });
      assertDescriptions(afterVoidVisible?.rows.map((row) => row.description) ?? [], ["Entered expense"], "After void showVoid rows");

      const [statementTransaction] = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.description, "Statement hidden"))
        .limit(1);
      const statementEditResponse = await fetch(
        `${server.baseUrl}/accounts/${account.id}/register/${statementTransaction.id}/edit`,
        { headers: { Cookie: cookie }, redirect: "manual" }
      );
      assert(statementEditResponse.status === 302, "Statement transactions cannot be edited.");

      const [voidTransaction] = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.description, "Void hidden"))
        .limit(1);
      const voidEditResponse = await fetch(`${server.baseUrl}/accounts/${account.id}/register/${voidTransaction.id}/edit`, {
        headers: { Cookie: cookie },
        redirect: "manual"
      });
      assert(voidEditResponse.status === 302, "Void transactions cannot be edited.");

      const reconcileResponse = await fetch(`${server.baseUrl}/accounts/${account.id}/reconcile?endingBalance=1150.00`, {
        headers: { Cookie: cookie }
      });
      const reconcileHtml = await reconcileResponse.text();
      assert(reconcileResponse.status === 200, "Reconciliation screen should load for a valid account.");
      assertTextIncludes(reconcileHtml, ["Pending expense", "Cleared deposit"], "Reconciliation eligible transactions");
      assertTextExcludes(reconcileHtml, ["Statement hidden", "Void hidden", "Recurring future"], "Reconciliation ineligible transactions");
      assert(reconcileHtml.includes("$150.00"), "Reconciliation screen should calculate and display the difference.");

      const selectedForStatement = await db
        .select({ id: transactions.id, description: transactions.description })
        .from(transactions)
        .where(inArray(transactions.description, ["Pending expense", "Cleared deposit"]));
      assert(selectedForStatement.length === 2, "Expected two selected reconciliation transactions.");
      const selectedParams = new URLSearchParams({
        statementDate: "2026-06-30",
        endingBalance: "1151.00"
      });
      for (const transaction of selectedForStatement) selectedParams.append("selectedTransactionIds", transaction.id);

      const failedReconcileResponse = await fetch(`${server.baseUrl}/accounts/${account.id}/reconcile`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
        body: selectedParams,
        redirect: "manual"
      });
      assert(failedReconcileResponse.status === 422, "Reconciliation cannot complete when the difference is not zero.");
      const statementsAfterFailure = await db.select({ id: accountStatements.id }).from(accountStatements).where(eq(accountStatements.accountId, account.id));
      assert(statementsAfterFailure.length === 0, "Failed reconciliation must not create a statement.");

      selectedParams.set("endingBalance", "1150.00");
      const completedReconcileResponse = await fetch(`${server.baseUrl}/accounts/${account.id}/reconcile`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
        body: selectedParams,
        redirect: "manual"
      });
      assert(completedReconcileResponse.status === 302, "Reconciliation completes when the difference is zero.");

      const [createdStatement] = await db
        .select()
        .from(accountStatements)
        .where(eq(accountStatements.accountId, account.id))
        .limit(1);
      assert(createdStatement, "Successful reconciliation should create a statement record.");
      assert(createdStatement.statementDate === "2026-06-30", "Statement record should keep the entered statement date.");
      assert(Number(createdStatement.endingBalance) === 1150, "Statement record should keep the ending balance.");

      const [createdSnapshot] = await db
        .select()
        .from(accountBalanceSnapshots)
        .where(and(eq(accountBalanceSnapshots.accountId, account.id), eq(accountBalanceSnapshots.snapshotDate, "2026-06-30")))
        .limit(1);
      assert(createdSnapshot, "Successful reconciliation should create a balance snapshot.");
      assert(Number(createdSnapshot.balance) === 1150, "Statement snapshot should equal the statement ending balance.");

      const selectedAfterReconcile = await db
        .select({ status: transactions.status, statementId: transactions.statementId })
        .from(transactions)
        .where(inArray(transactions.id, selectedForStatement.map((transaction) => transaction.id)));
      assert(
        selectedAfterReconcile.every((transaction) => transaction.status === "statement"),
        "Selected transactions should receive status=statement."
      );
      assert(
        selectedAfterReconcile.every((transaction) => transaction.statementId === createdStatement.id),
        "Selected transactions should receive the created statement id."
      );

      const afterStatementRegister = await getAccountRegister(account.id, { today });
      assertNotDescriptions(
        afterStatementRegister?.rows.map((row) => row.description) ?? [],
        ["Pending expense", "Cleared deposit"],
        "After reconciliation active register rows"
      );

      const statementsResponse = await fetch(`${server.baseUrl}/accounts/${account.id}/statements`, {
        headers: { Cookie: cookie }
      });
      const statementsHtml = await statementsResponse.text();
      assert(statementsResponse.status === 200, "Statement history route should load.");
      assert(statementsHtml.includes("2026-06-30"), "Statement history should display the statement date.");
      assert(statementsHtml.includes("2"), "Statement history should display the attached transaction count.");

      const statementDetailResponse = await fetch(`${server.baseUrl}/accounts/${account.id}/statements/${createdStatement.id}`, {
        headers: { Cookie: cookie }
      });
      const statementDetailHtml = await statementDetailResponse.text();
      assert(statementDetailResponse.status === 200, "Statement detail route should load.");
      assertTextIncludes(statementDetailHtml, ["Pending expense", "Cleared deposit"], "Statement detail attached transactions");
      assert(
        completeAccountReconciliation.toString().includes("db.transaction"),
        "Reconciliation completion should run inside a database transaction."
      );
    } finally {
      await server.close();
    }

    console.log("Register flow check passed.");
  } finally {
    await cleanup();
    await pool.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
