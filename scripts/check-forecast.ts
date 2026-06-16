import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import { app } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import { accounts, accountStatements, futureCommitments, transactions, users } from "../src/db/schema.js";
import { Accounts } from "../src/services/accounts.service.js";
import { getAccountProjection } from "../src/services/projections.service.js";
import { createTransfer } from "../src/services/transfers.service.js";

const accountNames = [
  "Forecast Smoke Checking",
  "Forecast Smoke Savings",
  "Forecast Smoke Card",
  "Forecast Smoke Warning"
];
const commitmentNames = [
  "Forecast Smoke Rent",
  "Forecast Smoke Subscription",
  "Forecast Smoke Card Fee",
  "Forecast Smoke Warning Bill"
];
const testUserEmail = "forecast-smoke@example.com";
const testPassword = "forecast-smoke-password";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const cleanup = async () => {
  await db.delete(futureCommitments).where(inArray(futureCommitments.name, commitmentNames));
  const rows = await db.select({ id: accounts.id }).from(accounts).where(inArray(accounts.name, accountNames));
  const accountIds = rows.map((row) => row.id);
  if (accountIds.length) {
    await db.delete(transactions).where(inArray(transactions.accountId, accountIds));
    await db.delete(accountStatements).where(inArray(accountStatements.accountId, accountIds));
    await db.delete(accounts).where(inArray(accounts.id, accountIds));
  }
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

  const checking = await Accounts.createAccount({
    name: "Forecast Smoke Checking",
    type: "checking",
    startingInformation: { balance: "1000.00", date: "2026-01-01" }
  });
  const savings = await Accounts.createAccount({
    name: "Forecast Smoke Savings",
    type: "savings",
    startingInformation: { balance: "200.00", date: "2026-01-01" }
  });
  const card = await Accounts.createAccount({
    name: "Forecast Smoke Card",
    type: "credit_card",
    startingInformation: { balance: "-100.00", date: "2026-01-01" }
  });
  const warning = await Accounts.createAccount({
    name: "Forecast Smoke Warning",
    type: "checking",
    startingInformation: { balance: "10.00", date: "2026-01-01" }
  });
  const passwordHash = await bcrypt.hash(testPassword, 4);
  await db.insert(users).values({ email: testUserEmail, passwordHash, displayName: "Forecast Smoke" });

  try {
    await db.insert(transactions).values([
      {
        accountId: checking.id,
        date: "2026-06-10",
        amount: "-100.00",
        status: "entered",
        description: "Before as-of actual"
      },
      {
        accountId: checking.id,
        date: "2026-06-15",
        amount: "50.00",
        status: "pending",
        description: "As-of day actual"
      },
      {
        accountId: checking.id,
        date: "2026-06-20",
        amount: "-25.00",
        status: "entered",
        description: "Same day manual future"
      },
      {
        accountId: checking.id,
        date: "2026-07-30",
        amount: "-40.00",
        status: "entered",
        description: "Sixty day only future"
      },
      {
        accountId: checking.id,
        date: "2026-06-18",
        amount: "-999.00",
        status: "void",
        description: "Void future excluded"
      }
    ]);

    await createTransfer({
      date: "2026-06-20",
      amount: 75,
      sourceAccountId: checking.id,
      destinationAccountId: savings.id,
      status: "entered",
      notes: "Forecast transfer"
    });

    await db.insert(futureCommitments).values([
      {
        name: "Forecast Smoke Rent",
        accountId: checking.id,
        amount: "-300.00",
        frequency: "monthly",
        nextDueDate: "2026-06-20",
        startDate: "2026-06-01",
        active: true
      },
      {
        name: "Forecast Smoke Subscription",
        accountId: checking.id,
        amount: "-10.00",
        frequency: "monthly",
        nextDueDate: "2026-08-20",
        startDate: "2026-08-01",
        active: true
      },
      {
        name: "Forecast Smoke Card Fee",
        accountId: card.id,
        amount: "-50.00",
        frequency: "once",
        nextDueDate: "2026-06-20",
        startDate: "2026-06-01",
        active: true
      },
      {
        name: "Forecast Smoke Warning Bill",
        accountId: warning.id,
        amount: "-20.00",
        frequency: "once",
        nextDueDate: "2026-06-20",
        startDate: "2026-06-01",
        active: true
      }
    ]);

    const beforeAccount = await Accounts.getAccount(checking.id);
    const beforeTransactionCount = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.accountId, checking.id));
    const beforeStatementCount = await db.select({ id: accountStatements.id }).from(accountStatements).where(eq(accountStatements.accountId, checking.id));

    const thirtyDay = await getAccountProjection(checking.id, { asOfDate: "2026-06-15", windowDays: 30 });
    assert(thirtyDay, "30-day projection should load.");
    assert(thirtyDay.projectionStartBalance === "950.00", "Projection start should include only transactions dated on or before as-of date.");
    assert(
      !thirtyDay.items.some((item) => item.name === "Before as-of actual" || item.name === "As-of day actual"),
      "Projection items should not include transactions already captured in the start balance."
    );
    assert(
      thirtyDay.items.some((item) => item.name === "Same day manual future"),
      "Future-dated transactions inside the window should be projected."
    );
    assert(
      !thirtyDay.items.some((item) => item.name === "Sixty day only future"),
      "30-day projection should exclude items outside the 30-day window."
    );
    assert(thirtyDay.projectedEndingBalance === "550.00", "30-day projected ending balance should apply commitment, transfer, and future transaction once.");
    assert(thirtyDay.projectedLowBalance === "550.00", "30-day projected low balance should include projected running balances.");
    assert(thirtyDay.projectedHighBalance === "950.00", "30-day projected high balance should include the start balance.");

    const sameDayItems = thirtyDay.items.filter((item) => item.date === "2026-06-20");
    assert(
      sameDayItems.map((item) => item.source).join(",") === "future_commitment,transfer,future_transaction",
      "Same-day projection order should be commitment, transfer, future transaction."
    );
    assert(
      sameDayItems.map((item) => item.runningBalance).join(",") === "650.00,575.00,550.00",
      "Running balance should change on the projected item date in same-day order."
    );

    const sixtyDay = await getAccountProjection(checking.id, { asOfDate: "2026-06-15", windowDays: 60 });
    assert(sixtyDay?.items.some((item) => item.name === "Sixty day only future"), "60-day projection should include later future transactions.");
    assert(sixtyDay?.items.some((item) => item.id.endsWith(":2026-07-20")), "Recurring commitments should expand inside the window.");
    assert(sixtyDay?.projectedEndingBalance === "210.00", "60-day projected ending balance should include recurring commitment and later transaction.");

    const ninetyDay = await getAccountProjection(checking.id, { asOfDate: "2026-06-15", windowDays: 90 });
    assert(ninetyDay?.items.some((item) => item.name === "Forecast Smoke Subscription"), "90-day projection should include commitments outside 60 days.");
    assert(ninetyDay?.projectedEndingBalance === "-100.00", "90-day projected ending balance should include all in-window recurring commitments.");
    assert(ninetyDay?.warningDates.includes("2026-08-20"), "Asset-style account should warn when projected below zero.");

    const cardProjection = await getAccountProjection(card.id, { asOfDate: "2026-06-15", windowDays: 30 });
    assert(cardProjection?.projectedEndingBalance === "-150.00", "Credit card projection should keep signed internal math.");
    assert(cardProjection.warningDates.length === 0, "Credit card projection should not show negative-balance warnings in Step 3.");

    const afterAccount = await Accounts.getAccount(checking.id);
    const afterTransactionCount = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.accountId, checking.id));
    const afterStatementCount = await db.select({ id: accountStatements.id }).from(accountStatements).where(eq(accountStatements.accountId, checking.id));
    assert(
      beforeAccount?.data.statementChainBalance === afterAccount?.data.statementChainBalance,
      "Projection should not mutate authoritative account balances."
    );
    assert(beforeTransactionCount.length === afterTransactionCount.length, "Projection should not create or remove transactions.");
    assert(beforeStatementCount.length === afterStatementCount.length, "Projection should not create or remove statements.");

    const server = await startServer();
    try {
      const cookie = await login(server.baseUrl);
      const forecastResponse = await fetch(`${server.baseUrl}/accounts/${checking.id}/forecast?window=90`, { headers: { cookie } });
      const forecastHtml = await forecastResponse.text();
      assert(forecastResponse.status === 200, "Forecast route should load.");
      assert(forecastHtml.includes("Projection Start Balance"), "Forecast page should name the projection start balance.");
      assert(forecastHtml.includes("Projected Ending Balance"), "Forecast page should show projected ending balance.");
      assert(forecastHtml.includes("Forecast Smoke Rent"), "Forecast page should show generated future commitment occurrences.");
      assert(forecastHtml.includes("Future Commitment"), "Forecast page should label future commitment rows.");
      assert(forecastHtml.includes("Transfer"), "Forecast page should label transfer rows.");
      assert(forecastHtml.includes("Future Transaction"), "Forecast page should label future transaction rows.");
      assert(forecastHtml.includes("Projected below zero"), "Forecast page should show asset-account warning dates when applicable.");

      const registerResponse = await fetch(`${server.baseUrl}/accounts/${checking.id}/register`, { headers: { cookie } });
      const registerHtml = await registerResponse.text();
      assert(registerResponse.status === 200, "Register route should still load.");
      assert(registerHtml.includes(`/accounts/${checking.id}/forecast`), "Register should link to forecast.");
      assert(!registerHtml.includes("Forecast Smoke Rent"), "Register should not include generated future commitment occurrences.");

      const accountsResponse = await fetch(`${server.baseUrl}/accounts`, { headers: { cookie } });
      const accountsHtml = await accountsResponse.text();
      assert(accountsResponse.status === 200, "Accounts route should load.");
      assert(accountsHtml.includes(`/accounts/${checking.id}/forecast`), "Accounts list should link to forecast.");

      const dashboardResponse = await fetch(`${server.baseUrl}/dashboard`, { headers: { cookie } });
      const dashboardHtml = await dashboardResponse.text();
      assert(dashboardResponse.status === 200, "Dashboard route should load.");
      assert(dashboardHtml.includes("30-Day Projected Low"), "Dashboard should include the lightweight projection summary.");
      assert(dashboardHtml.includes("Projected below zero"), "Dashboard should link warnings for asset accounts projected below zero.");
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
