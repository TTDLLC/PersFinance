import bcrypt from "bcryptjs";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { app } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import { accounts, accountStatements, categories, payees, transactions, users } from "../src/db/schema.js";
import { Accounts } from "../src/services/accounts.service.js";
import { getAccountRegister } from "../src/services/accountRegister.service.js";

const testAccountName = "Register Smoke Account";
const testCategoryName = "Register Smoke Category";
const testPayeeName = "Register Smoke Payee";
const testUserEmail = "register-smoke@example.com";
const testPassword = "register-smoke-password";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const assertTextExcludes = (actual: string, unexpected: string[], label: string) => {
  const found = unexpected.filter((text) => actual.includes(text));
  assert(!found.length, `${label}: unexpectedly found ${found.join(", ")}`);
};

const cleanup = async () => {
  const staleAccounts = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.name, testAccountName));
  const accountIds = staleAccounts.map((account) => account.id);
  if (accountIds.length) {
    await db.delete(transactions).where(inArray(transactions.accountId, accountIds));
    await db.delete(accountStatements).where(inArray(accountStatements.accountId, accountIds));
    await db.delete(accounts).where(inArray(accounts.id, accountIds));
  }
  await db.delete(categories).where(eq(categories.name, testCategoryName));
  await db.delete(payees).where(eq(payees.name, testPayeeName));
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

const login = async (baseUrl: string) => {
  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email: testUserEmail, password: testPassword }).toString()
  });
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Login did not return a session cookie.");
  return cookie;
};

const main = async () => {
  await cleanup();

  const account = await Accounts.createAccount({
    name: testAccountName,
    type: "checking",
    startingInformation: { balance: "500.00", date: "2026-06-01" },
    displayOrder: 999
  });
  const [payee] = await db.insert(payees).values({ name: testPayeeName }).returning({ id: payees.id });
  const [category] = await db.insert(categories).values({ name: testCategoryName, type: "expense" }).returning({ id: categories.id });
  const passwordHash = await bcrypt.hash(testPassword, 4);
  await db.insert(users).values({ email: testUserEmail, passwordHash, displayName: "Register Smoke" });

  try {
    const inserted = await db
      .insert(transactions)
      .values([
        { accountId: account.id, payeeId: payee.id, categoryId: category.id, date: "2026-06-02", amount: "-100.00", status: "entered", description: "Entered expense" },
        { accountId: account.id, payeeId: payee.id, categoryId: category.id, date: "2026-06-03", amount: "-50.00", status: "pending", description: "Pending expense" },
        { accountId: account.id, payeeId: payee.id, categoryId: category.id, date: "2026-06-04", amount: "200.00", status: "cleared", description: "Cleared deposit" },
        { accountId: account.id, payeeId: payee.id, categoryId: category.id, date: "2026-06-05", amount: "-500.00", status: "void", description: "Void hidden" }
      ])
      .returning({ id: transactions.id, description: transactions.description });

    const defaultRegister = await getAccountRegister(account.id);
    assert(defaultRegister, "Default active register should load.");
    assert(defaultRegister?.rows.length === 3, "Default active register should exclude void transactions.");
    assert(defaultRegister.balance.statementBalance === "500.00", "Register header balance should use the statement-chain anchor.");
    assert(defaultRegister.balance.currentBalance === "550.00", "Current Balance should continue to include active transactions.");
    assert(defaultRegister.rows.at(-1)?.balanceAfter === 550, "Default active register should track running balance from statement-chain balance.");

    const allRegister = await getAccountRegister(account.id, "all");
    assert(allRegister?.rows.length === 3, "Show all should exclude void transactions.");

    const voidRegister = await getAccountRegister(account.id, "void");
    assert(voidRegister?.rows.length === 1 && voidRegister.rows[0].description === "Void hidden", "Void view should show only void transactions.");

    const selectedIds = inserted.filter((row) => row.description !== "Void hidden").map((row) => row.id);
    const preview = await account.previewReconciliation({
      statementDate: "2026-06-30",
      endingBalance: 999,
      selectedTransactionIds: selectedIds
    });
    assert(preview.difference !== "0.00", "Failed reconciliation preview should show a non-zero difference.");
    const beforeFailed = await db.select().from(transactions).where(and(eq(transactions.accountId, account.id), isNotNull(transactions.statementId)));
    assert(beforeFailed.length === 0, "Preview must not assign statementId.");

    let failed = false;
    try {
      await account.reconcileStatement({
        statementDate: "2026-06-30",
        endingBalance: 999,
        selectedTransactionIds: selectedIds
      });
    } catch {
      failed = true;
    }
    assert(failed, "Mismatched reconciliation should fail.");
    const afterFailed = await db.select().from(transactions).where(and(eq(transactions.accountId, account.id), isNotNull(transactions.statementId)));
    assert(afterFailed.length === 0, "Failed reconciliation must leave transactions untouched.");

    const result = await account.reconcileStatement({
      statementDate: "2026-06-30",
      endingBalance: 550,
      selectedTransactionIds: selectedIds
    });
    const reconciledRows = await db.select().from(transactions).where(eq(transactions.statementId, result.statementId));
    assert(reconciledRows.length === 3, "Finalized reconciliation should assign statementId.");
    assert(reconciledRows.every((row) => row.status === "cleared"), "Finalized reconciliation should set selected transaction status to cleared.");

    const reloaded = await Accounts.getAccount(account.id);
    assert(reloaded, "Account should reload after reconciliation.");
    assert(reloaded?.data.statementChainBalance === "550.00", "Finalized reconciliation should update statement-chain balance.");
    assert(reloaded.data.lastReconciledDate === "2026-06-30", "Finalized reconciliation should update statement-chain date.");
    assert(reloaded.data.lastReconciledStatementId === result.statementId, "Finalized reconciliation should update statement-chain statement id.");
    assert((await getAccountRegister(account.id))?.rows.length === 0, "Reconciled transactions should leave the default active register.");

    const [unreconciledTransaction] = await db
      .insert(transactions)
      .values({
        accountId: account.id,
        payeeId: payee.id,
        categoryId: category.id,
        date: "2026-07-01",
        amount: "-25.00",
        status: "entered",
        description: "Unreconciled after statement"
      })
      .returning({ id: transactions.id });

    const registerAfterActivity = await getAccountRegister(account.id);
    assert(registerAfterActivity, "Register should load after unreconciled activity.");
    assert(registerAfterActivity.balance.statementBalance === "550.00", "Unreconciled activity must not change the register header anchor balance.");
    assert(registerAfterActivity.balance.currentBalance === "525.00", "Current Balance should still reflect unreconciled activity.");
    assert(registerAfterActivity.rows.at(-1)?.balanceAfter === 525, "Running balance should begin at the reconciled anchor.");

    const server = await startServer();
    try {
      const cookie = await login(server.baseUrl);
      const dashboardResponse = await fetch(`${server.baseUrl}/dashboard`, { headers: { cookie } });
      const dashboardHtml = await dashboardResponse.text();
      assert(dashboardResponse.status === 200, "Dashboard route should load.");
      assert(dashboardHtml.includes("Current Balance"), "Dashboard should show Current Balance.");
      assert(dashboardHtml.includes(`class="small-button" href="/accounts/${account.id}/register">Register</a>`), "Dashboard should show a Register action button.");
      assert(!dashboardHtml.includes(`href="/accounts/${account.id}/register">${testAccountName}</a>`), "Dashboard account name should not be the register link.");
      assertTextExcludes(dashboardHtml, ["Working Balance", "Snapshot Balance", "Post-Snapshot Activity", "Projection"], "Dashboard old balance concepts");

      const registerResponse = await fetch(`${server.baseUrl}/accounts/${account.id}/register`, { headers: { cookie } });
      const registerHtml = await registerResponse.text();
      assert(registerResponse.status === 200, "Account register route should load.");
      assert(registerHtml.includes("Reconciled on 2026-06-30, Balance: $550.00"), "Register header should show the last reconciliation and anchor balance.");
      assert(!registerHtml.includes("Balance: $525.00"), "Register header should not show the rolling current balance.");
      assert(!registerHtml.includes(`/accounts/${account.id}/reconcile`), "Register should not link directly to reconciliation.");
      const newTransactionPosition = registerHtml.indexOf(">New Transaction</a>");
      const statementsPosition = registerHtml.indexOf(">Statements</a>");
      const accountSettingsPosition = registerHtml.indexOf(">Account Settings</a>");
      assert(
        newTransactionPosition >= 0 && newTransactionPosition < statementsPosition && statementsPosition < accountSettingsPosition,
        "Register actions should be ordered New Transaction, Statements, Account Settings."
      );

      const allRegisterResponse = await fetch(`${server.baseUrl}/accounts/${account.id}/register?view=all`, { headers: { cookie } });
      const allRegisterHtml = await allRegisterResponse.text();
      assert(allRegisterResponse.status === 200, "All-transactions register route should load.");
      assert(
        allRegisterHtml.includes('class="statement-linked-indicator"') && allRegisterHtml.includes('aria-label="Reconciled"'),
        "Statement-linked register transactions should show an accessible reconciled indicator."
      );

      const reconciliationResponse = await fetch(`${server.baseUrl}/accounts/${account.id}/reconcile`, { headers: { cookie } });
      const reconciliationHtml = await reconciliationResponse.text();
      assert(reconciliationResponse.status === 200, "Reconciliation route should load.");
      assert(
        reconciliationHtml.includes("Shift-click a transaction to select or clear the full range"),
        "Reconciliation should explain shift-click range selection."
      );
      assert(
        reconciliationHtml.includes("data-reconcile-transaction"),
        "Reconciliation transaction checkboxes should expose the client-side selection hook."
      );
      assert(
        reconciliationHtml.includes("data-reconciliation-sticky"),
        "Reconciliation controls should expose the sticky header hook."
      );
      const reconciliationSummaryPosition = reconciliationHtml.indexOf("reconciliation-summary");
      const cancelPosition = reconciliationHtml.indexOf(">Cancel</a>");
      const completePosition = reconciliationHtml.indexOf(">Complete Reconciliation</button>");
      const reconciliationTablePosition = reconciliationHtml.indexOf("<table>");
      assert(
        reconciliationSummaryPosition >= 0 &&
          reconciliationSummaryPosition < cancelPosition &&
          cancelPosition < completePosition &&
          completePosition < reconciliationTablePosition,
        "Cancel and Complete Reconciliation should appear below the summary and above the transaction table."
      );

      const largeSelection = new URLSearchParams({
        statementDate: "2026-07-31",
        endingBalance: "525.00",
        notes: "Large selection parser regression"
      });
      for (let index = 0; index < 1_200; index += 1) {
        largeSelection.append("selectedTransactionIds", unreconciledTransaction.id);
      }
      const largeSelectionResponse = await fetch(`${server.baseUrl}/accounts/${account.id}/reconcile`, {
        method: "POST",
        redirect: "manual",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded"
        },
        body: largeSelection.toString()
      });
      assert(
        largeSelectionResponse.status === 302 &&
          largeSelectionResponse.headers.get("location")?.startsWith(`/accounts/${account.id}/statements/`),
        "Reconciliation should accept more than 1,000 selected transaction parameters."
      );

      const oversizedMarker = "must-not-appear-in-error-logs";
      const oversizedRequest = new URLSearchParams();
      for (let index = 0; index < 50_001; index += 1) {
        oversizedRequest.append("field", oversizedMarker);
      }
      const errorLogs: unknown[][] = [];
      const originalConsoleError = console.error;
      console.error = (...args: unknown[]) => {
        errorLogs.push(args);
      };
      let oversizedResponse: Response;
      try {
        oversizedResponse = await fetch(`${server.baseUrl}/login`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: oversizedRequest.toString()
        });
      } finally {
        console.error = originalConsoleError;
      }
      const oversizedHtml = await oversizedResponse.text();
      assert(oversizedResponse.status === 413, "Requests beyond the bounded parameter limit should return 413.");
      assert(oversizedHtml.includes("Request Too Large"), "The 413 response should render a friendly error page.");
      assert(!oversizedHtml.includes("currentUser is not defined"), "The error page should not fail while rendering navigation.");
      assert(
        !JSON.stringify(errorLogs).includes(oversizedMarker),
        "Request parsing errors should not log raw submitted form data."
      );
    } finally {
      await server.close();
    }
  } finally {
    await cleanup();
    await pool.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
