import bcrypt from "bcryptjs";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { app } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import { accounts, accountStatements, categories, futureCommitments, payees, transactions, users } from "../src/db/schema.js";
import { Accounts } from "../src/services/accounts.service.js";
import { getAccountRegister } from "../src/services/accountRegister.service.js";

const testAccountName = "Register Smoke Account";
const accountGroupSmokeNames = [
  "Register Smoke Savings Group",
  "Register Smoke Card Group",
  "Register Smoke Loan Group",
  "Register Smoke Other Group"
];
const testCategoryName = "Register Smoke Category";
const testPayeeName = "Register Smoke Payee";
const testCommitmentName = "Register Smoke Upcoming Commitment";
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
  await db.delete(futureCommitments).where(eq(futureCommitments.name, testCommitmentName));
  const staleAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(inArray(accounts.name, [testAccountName, ...accountGroupSmokeNames]));
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
  await Promise.all([
    Accounts.createAccount({
      name: accountGroupSmokeNames[0],
      type: "savings",
      startingInformation: { balance: "0.00", date: "2026-06-01" },
      displayOrder: 1000
    }),
    Accounts.createAccount({
      name: accountGroupSmokeNames[1],
      type: "credit_card",
      startingInformation: { balance: "0.00", date: "2026-06-01" },
      displayOrder: 1001
    }),
    Accounts.createAccount({
      name: accountGroupSmokeNames[2],
      type: "loan",
      startingInformation: { balance: "0.00", date: "2026-06-01" },
      displayOrder: 1002
    }),
    Accounts.createAccount({
      name: accountGroupSmokeNames[3],
      type: "cash",
      startingInformation: { balance: "0.00", date: "2026-06-01" },
      displayOrder: 1003
    })
  ]);
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
    assert(defaultRegister?.selectedStatuses.join(",") === "entered,pending,cleared", "Default register view should include Entered, Pending, and Cleared.");
    assert(defaultRegister?.rows.length === 3, "Default register should show active entered, pending, and cleared transactions.");
    assert(defaultRegister.balance.statementBalance === "500.00", "Register header balance should use the statement-chain anchor.");
    assert(defaultRegister.balance.currentBalance === "700.00", "Current Balance should include cleared transactions only.");
    assert(defaultRegister.balanceSummary.currentBalance === 700, "Register summary current balance should include cleared transactions only.");
    assert(defaultRegister.balanceSummary.enteredBalance === 100, "Register summary should expose entered balance.");
    assert(defaultRegister.balanceSummary.pendingBalance === 50, "Register summary should expose pending balance.");
    assert(defaultRegister.balanceSummary.finalBalance === 550, "Register summary final balance should subtract entered and pending balances.");
    assert(defaultRegister.rows.find((row) => row.status === "entered")?.balance === null, "Entered rows should not expose a running balance amount.");
    assert(defaultRegister.rows.find((row) => row.status === "pending")?.balance === null, "Pending rows should not expose a running balance amount.");

    const pendingRegister = await getAccountRegister(account.id, ["pending"]);
    assert(pendingRegister?.rows.length === 1 && pendingRegister.rows[0].description === "Pending expense", "Pending view should show pending transactions.");

    const clearedRegister = await getAccountRegister(account.id, ["cleared"]);
    assert(clearedRegister?.rows.length === 1 && clearedRegister.rows[0].balance === 700, "Cleared view should update the running balance.");

    const combinedRegister = await getAccountRegister(account.id, ["entered", "pending", "cleared"]);
    assert(combinedRegister?.rows.length === 3, "Combined Entered + Pending + Cleared filter should show all active statuses.");

    const allRegister = await getAccountRegister(account.id, ["entered", "pending", "cleared", "void"]);
    assert(allRegister?.rows.length === 4, "All view should include every transaction status.");

    const voidRegister = await getAccountRegister(account.id, ["void"]);
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
    assert(registerAfterActivity.balance.currentBalance === "550.00", "Current Balance should ignore entered unreconciled activity.");
    assert(registerAfterActivity.rows.at(-1)?.balance === null, "Entered rows after reconciliation should not expose a running balance amount.");

    await db.insert(futureCommitments).values({
      name: testCommitmentName,
      accountId: account.id,
      amount: "-25.00",
      frequency: "once",
      nextDueDate: "2026-06-29",
      startDate: "2026-06-01",
      active: true
    });

    const server = await startServer();
    try {
      const cookie = await login(server.baseUrl);
      const dashboardResponse = await fetch(`${server.baseUrl}/dashboard`, { headers: { cookie } });
      const dashboardHtml = await dashboardResponse.text();
      assert(dashboardResponse.status === 200, "Dashboard route should load.");
      assert(dashboardHtml.includes("Upcoming Future Commitments"), "Dashboard should show upcoming future commitments.");
      assert(dashboardHtml.includes(testCommitmentName), "Dashboard should show commitments due in the next 14 days.");
      assert(dashboardHtml.includes("Enter Early"), "Dashboard should allow early commitment entry.");
      assert(dashboardHtml.includes('class="small-button" href="/commitments/'), "Dashboard future commitment actions should render as buttons.");
      assert(!dashboardHtml.includes(`class="small-button" href="/accounts/${account.id}/register">Register</a>`), "Dashboard should not show account-list Register actions.");
      assertTextExcludes(dashboardHtml, ["30-Day Projected Low", "Working Balance", "Snapshot Balance", "Post-Snapshot Activity", "Projection"], "Dashboard old account-list concepts");

      const registerResponse = await fetch(`${server.baseUrl}/accounts/${account.id}/register`, { headers: { cookie } });
      const registerHtml = await registerResponse.text();
      assert(registerResponse.status === 200, "Account register route should load.");
      assert(registerHtml.includes("Reconciled on 2026-06-30, Balance: $550.00"), "Register header should show the last reconciliation and anchor balance.");
      assert(!registerHtml.includes("Balance: $525.00"), "Register header should not show the rolling current balance.");
      assert(!registerHtml.includes(`/accounts/${account.id}/reconcile`), "Register should not link directly to reconciliation.");
      assert(["entered", "pending", "cleared", "void"].every((status) => registerHtml.includes(`name="status" value="${status}"`)), "Register filter should expose multi-select status checkboxes.");
      assert(registerHtml.includes("data-register-status-all"), "Register filter should expose an All status control.");
      assert(!registerHtml.includes(">Show All</option>") && !registerHtml.includes(">Active</option>"), "Register filter should not show old Active/Show All labels.");
      assert(!registerHtml.includes(">Update</button>"), "Register filter should auto-submit without an Update button.");
      assert(registerHtml.includes("<th>Balance</th>") && !registerHtml.includes("Balance After"), "Register should rename Balance After to Balance.");
      assert(registerHtml.includes('<span class="muted">&mdash;</span>'), "Register should show a muted dash instead of a balance amount for non-cleared rows.");
      assert(registerHtml.includes("Current Balance") && registerHtml.includes("Entered Balance") && registerHtml.includes("Pending Balance") && registerHtml.includes("Final Balance"), "Register should show compact balance summary.");
      assert(registerHtml.includes("Mark Selected Cleared") && registerHtml.includes("Mark Selected Pending") && registerHtml.includes("Mark Selected Entered"), "Register should expose intentional bulk status actions.");
      const newTransactionPosition = registerHtml.indexOf(">New Entry</a>");
      const statementsPosition = registerHtml.indexOf(">Statements</a>");
      const accountSettingsPosition = registerHtml.indexOf(">Account Settings</a>");
      assert(
        newTransactionPosition >= 0 && newTransactionPosition < statementsPosition && statementsPosition < accountSettingsPosition,
        "Register actions should be ordered New Entry, Statements, Account Settings."
      );

      const newEntryResponse = await fetch(`${server.baseUrl}/accounts/${account.id}/register/new`, { headers: { cookie } });
      const newEntryHtml = await newEntryResponse.text();
      assert(newEntryResponse.status === 200, "New register entry route should load.");
      assert(newEntryHtml.includes('name="entryKind" value="transaction"') && newEntryHtml.includes('name="entryKind" value="transfer"'), "Unified register entry form should provide Transaction / Transfer toggle.");
      assert(newEntryHtml.includes("data-register-entry-form"), "Unified register entry form should expose the client behavior hook.");
      assert(newEntryHtml.includes('name="sourceAccountId"') && newEntryHtml.includes('name="destinationAccountId"'), "Unified register entry form should include transfer fields.");
      const fieldOrder = [
        'class="register-field-date"',
        'class="register-field-payee"',
        'class="register-field-status"',
        'class="register-field-from"',
        'class="register-field-amount"',
        'class="register-field-to"',
        'class="register-field-category"'
      ].map((marker) => newEntryHtml.indexOf(marker));
      assert(fieldOrder.every((index) => index >= 0), "Unified register entry form should expose requested field-order classes.");
      assert(
        fieldOrder.every((index, position) => position === 0 || index > fieldOrder[position - 1]),
        "Unified register entry form fields should be ordered Date, Payee, Status, From Account, Amount, To Account, Category."
      );

      const combinedRegisterResponse = await fetch(`${server.baseUrl}/accounts/${account.id}/register?status=entered&status=pending&status=cleared`, { headers: { cookie } });
      const combinedRegisterHtml = await combinedRegisterResponse.text();
      assert(
        combinedRegisterResponse.status === 200 &&
          combinedRegisterHtml.includes("Unreconciled after statement") &&
          !combinedRegisterHtml.includes("Void hidden"),
        "Combined status filter should support Entered + Pending + Cleared without Voided."
      );

      const allRegisterResponse = await fetch(`${server.baseUrl}/accounts/${account.id}/register?status=all`, { headers: { cookie } });
      const allRegisterHtml = await allRegisterResponse.text();
      assert(allRegisterResponse.status === 200, "All-transactions register route should load.");
      assert(
        allRegisterHtml.includes('class="statement-linked-indicator"') && allRegisterHtml.includes('aria-label="Reconciled"'),
        "Statement-linked register transactions should show an accessible reconciled indicator."
      );

      const accountsResponse = await fetch(`${server.baseUrl}/accounts`, { headers: { cookie } });
      const accountsHtml = await accountsResponse.text();
      assert(accountsResponse.status === 200, "Accounts route should load.");
      const groupOrder = ["Checking", "Savings", "Credit Card", "Loans", "Others"].map((group) =>
        accountsHtml.indexOf(`<tr class="account-type-row"><th colspan="3">${group}</th></tr>`)
      );
      assert(groupOrder.every((index) => index >= 0), "Accounts page should include all ordered account groups.");
      assert(groupOrder.every((index, position) => position === 0 || index > groupOrder[position - 1]), "Accounts page should order groups Checking, Savings, Credit Card, Loans, Others.");
      assert(!accountsHtml.includes("<th>Name</th><th>Type</th>"), "Accounts page should remove repeated per-row type column.");
      assert(!accountsHtml.includes("<th>Status</th>") && !accountsHtml.includes("<th>Actions</th>"), "Accounts page should remove Status and Actions column headers.");

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
