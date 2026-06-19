import bcrypt from "bcryptjs";
import { eq, inArray, like } from "drizzle-orm";
import { app } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import { accounts, accountStatements, futureCommitments, scenarios, transactions, users } from "../src/db/schema.js";
import { Accounts } from "../src/services/accounts.service.js";
import { getOverdueCommitments, listScenarioCommitments } from "../src/services/futureCommitments.service.js";
import { getAccountProjection } from "../src/services/projections.service.js";

const scenarioPrefix = "Step 4.5 Smoke Scenario";
const commitmentPrefix = "Step 4.5 Smoke Commitment";
const accountPrefix = "Step 4.5 Smoke";
const testUserEmail = "step45-smoke@example.com";
const testPassword = "step45-smoke-password";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  console.log(`  [ok] ${message}`);
}

const cleanup = async () => {
  const scenarioRows = await db.select({ id: scenarios.id }).from(scenarios).where(like(scenarios.name, `${scenarioPrefix}%`));
  const scenarioIds = scenarioRows.map((row) => row.id);
  if (scenarioIds.length) await db.delete(scenarios).where(inArray(scenarios.id, scenarioIds));
  await db.delete(futureCommitments).where(like(futureCommitments.name, `${commitmentPrefix}%`));
  const smokeAccounts = await db.select({ id: accounts.id }).from(accounts).where(inArray(accounts.name, [
    `${accountPrefix} Checking`,
    `${accountPrefix} Savings`
  ]));
  const smokeIds = smokeAccounts.map((row) => row.id);
  if (smokeIds.length) {
    await db.delete(transactions).where(inArray(transactions.accountId, smokeIds));
    await db.delete(accountStatements).where(inArray(accountStatements.accountId, smokeIds));
    await db.delete(accounts).where(inArray(accounts.id, smokeIds));
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

const postForm = async (url: string, cookie: string, body: URLSearchParams) =>
  fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
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

const getHtml = async (url: string, cookie: string) => {
  const response = await fetch(url, { headers: { cookie } });
  const html = await response.text();
  return { response, html };
};

const countRows = async (accountId: string) => {
  const [transactionRows, statementRows, accountRows] = await Promise.all([
    db.select({ id: transactions.id }).from(transactions).where(eq(transactions.accountId, accountId)),
    db.select({ id: accountStatements.id }).from(accountStatements).where(eq(accountStatements.accountId, accountId)),
    db.select({ id: accounts.id }).from(accounts)
  ]);
  return {
    transactions: transactionRows.length,
    statements: statementRows.length,
    accounts: accountRows.length
  };
};

const main = async () => {
  console.log("[step4.5] start");
  await cleanup();

  const checking = await Accounts.createAccount({
    name: `${accountPrefix} Checking`,
    type: "checking",
    startingInformation: { balance: "1000.00", date: "2026-06-01" }
  });
  const savings = await Accounts.createAccount({
    name: `${accountPrefix} Savings`,
    type: "savings",
    startingInformation: { balance: "300.00", date: "2026-06-01" }
  });
  await db.insert(users).values({
    email: testUserEmail,
    passwordHash: await bcrypt.hash(testPassword, 4),
    displayName: "Step 4.5 Smoke"
  });

  const server = await startServer();
  try {
    const cookie = await login(server.baseUrl);

    const normalCommitmentResponse = await postForm(
      `${server.baseUrl}/commitments`,
      cookie,
      new URLSearchParams({
        name: `${commitmentPrefix} Baseline`,
        accountId: checking.id,
        amount: "-25.00",
        frequency: "monthly",
        nextDueDate: "2026-06-20",
        startDate: "2026-06-20",
        endDate: "",
        notes: "",
        payeeId: "",
        categoryId: "",
        active: "true"
      })
    );
    assert(normalCommitmentResponse.status === 302, "Normal Future Commitment creation should redirect.");
    const [normalCommitment] = await db.select().from(futureCommitments).where(eq(futureCommitments.name, `${commitmentPrefix} Baseline`));
    assert(normalCommitment?.includeInBaseline === true && normalCommitment.scenarioId === null, "Normal Future Commitment should default into baseline.");

    const newScenario = await getHtml(`${server.baseUrl}/scenarios/new`, cookie);
    assert(newScenario.response.status === 200 && !newScenario.html.includes('name="accountIds"'), "New scenario form should not require account checkboxes.");

    const createScenarioResponse = await postForm(
      `${server.baseUrl}/scenarios`,
      cookie,
      new URLSearchParams({
        name: `${scenarioPrefix} Vacation`,
        description: "Vacation planning",
        notes: "Track hypothetical costs",
        active: "on"
      })
    );
    assert(createScenarioResponse.status === 302, "Scenario metadata creation should redirect.");
    const [scenario] = await db.select().from(scenarios).where(eq(scenarios.name, `${scenarioPrefix} Vacation`));
    assert(scenario, "Scenario should be created with metadata only.");

    const createItemResponse = await postForm(
      `${server.baseUrl}/scenarios/${scenario.id}/items`,
      cookie,
      new URLSearchParams({
        name: `${commitmentPrefix} Resort`,
        accountId: checking.id,
        amount: "-100.00",
        frequency: "monthly",
        nextDueDate: "2026-06-20",
        startDate: "2026-06-20",
        endDate: "2026-08-20",
        notes: "Scenario-only lodging",
        payeeId: "",
        categoryId: "",
        active: "true"
      })
    );
    assert(createItemResponse.status === 302, "Scenario item creation should redirect.");
    let [scenarioItem] = await listScenarioCommitments(scenario.id);
    assert(scenarioItem.accountId === checking.id && scenarioItem.includeInBaseline === false, "Scenario item should be scenario-only by default.");

    const detail = await getHtml(`${server.baseUrl}/scenarios/${scenario.id}`, cookie);
    assert(detail.html.includes(`${commitmentPrefix} Resort`) && detail.html.includes("Scenario Only"), "Scenario detail should show scenario item and status.");
    assert(detail.html.includes(`${accountPrefix} Checking`), "Scenario detail should derive linked accounts from scenario items.");

    const commitmentsBeforePromotion = await getHtml(`${server.baseUrl}/commitments`, cookie);
    assert(!commitmentsBeforePromotion.html.includes(`${commitmentPrefix} Resort`), "Future Commitments list should hide scenario-only items.");

    const beforeCounts = await countRows(checking.id);
    const baseline = await getAccountProjection(checking.id, { asOfDate: "2026-06-17", windowDays: 90 });
    assert(!baseline?.items.some((item) => item.name === `${commitmentPrefix} Resort`), "Baseline forecast should exclude scenario-only item.");

    const scenarioProjection = await getAccountProjection(checking.id, {
      asOfDate: "2026-06-17",
      windowDays: 90,
      scenarioIds: [scenario.id]
    });
    assert(scenarioProjection?.mode === "scenario", "Selecting scenario should enable scenario projection mode.");
    assert(
      scenarioProjection?.items.filter((item) => item.source === "scenario_commitment" && item.name === `${commitmentPrefix} Resort`).length === 3,
      "Recurring scenario item should generate overlay occurrences only when selected."
    );

    const dueBeforePromotion = await getOverdueCommitments(checking.id, "2026-06-21");
    assert(!dueBeforePromotion.some((item) => item.id === scenarioItem.id), "Due checks should ignore scenario-only items.");

    const promoteResponse = await postForm(`${server.baseUrl}/scenarios/${scenario.id}/items/${scenarioItem.id}/promote`, cookie, new URLSearchParams());
    assert(promoteResponse.status === 302, "Promoting a scenario item should redirect.");
    [scenarioItem] = await listScenarioCommitments(scenario.id);
    assert(scenarioItem.includeInBaseline === true, "Promoting should set includeInBaseline=true without duplicating the row.");

    const commitmentsAfterPromotion = await getHtml(`${server.baseUrl}/commitments`, cookie);
    assert(commitmentsAfterPromotion.html.includes(`${commitmentPrefix} Resort`), "Future Commitments list should show promoted scenario item.");
    assert(commitmentsAfterPromotion.html.includes(`Scenario: ${scenario.name}`), "Promoted scenario item should show a scenario badge.");

    const promotedBaseline = await getAccountProjection(checking.id, { asOfDate: "2026-06-17", windowDays: 90 });
    assert(
      promotedBaseline?.items.filter((item) => item.source === "future_commitment" && item.name === `${commitmentPrefix} Resort`).length === 3,
      "Promoted item should appear in baseline forecast."
    );
    const promotedScenarioProjection = await getAccountProjection(checking.id, {
      asOfDate: "2026-06-17",
      windowDays: 90,
      scenarioIds: [scenario.id]
    });
    assert(
      promotedScenarioProjection?.items.filter((item) => item.source === "scenario_commitment" && item.name === `${commitmentPrefix} Resort`).length === 0,
      "Promoted item should not double-count as a scenario overlay item."
    );
    assert(
      promotedScenarioProjection?.items.filter((item) => item.source === "future_commitment" && item.name === `${commitmentPrefix} Resort`).length === 3,
      "Promoted item should remain in selected-scenario projections through baseline."
    );

    const dueAfterPromotion = await getOverdueCommitments(checking.id, "2026-06-21");
    assert(dueAfterPromotion.some((item) => item.id === scenarioItem.id), "Due checks should include promoted scenario items.");

    const afterCounts = await countRows(checking.id);
    assert(beforeCounts.transactions === afterCounts.transactions, "Projection and promotion should not create transactions.");
    assert(beforeCounts.statements === afterCounts.statements, "Projection and promotion should not create statements.");
    assert(beforeCounts.accounts === afterCounts.accounts, "Projection and promotion should not create accounts.");

    const register = await getHtml(`${server.baseUrl}/accounts/${checking.id}/register`, cookie);
    assert(register.response.status === 200, "Register should still load.");
    assert(!register.html.includes(`${commitmentPrefix} Resort`), "Scenario commitment should not appear in register until entered through normal baseline workflow.");

    const savingsProjection = await getAccountProjection(savings.id, {
      asOfDate: "2026-06-17",
      windowDays: 90,
      scenarioIds: [scenario.id]
    });
    assert(savingsProjection?.mode === "baseline", "Scenario should not be selectable for unrelated accounts.");
  } finally {
    await server.close();
    await cleanup();
    await pool.end();
  }
};

main()
  .then(() => {
    console.log("[step4.5] complete");
  })
  .catch((error) => {
    console.error("[step4.5] failed", error);
    process.exitCode = 1;
  });
