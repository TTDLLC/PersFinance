import bcrypt from "bcryptjs";
import { eq, inArray, like } from "drizzle-orm";
import { app } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import { accounts, accountStatements, futureCommitments, scenarioAccounts, scenarioAdjustments, scenarios, transactions, users } from "../src/db/schema.js";
import {
  createScenario
} from "../src/services/scenarios.service.js";
import { createScenarioCommitment, listScenarioCommitments } from "../src/services/futureCommitments.service.js";
import { getAccountProjection } from "../src/services/projections.service.js";
import { Accounts } from "../src/services/accounts.service.js";

const scenarioPrefix = "Step 4 Smoke Scenario";
const accountPrefix = "Step 4 Smoke";
const testUserEmail = "step4-smoke@example.com";
const testPassword = "step4-smoke-password";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  console.log(`  [ok] ${message}`);
}

const listScenarioIds = async () => {
  const rows = await db.select({ id: scenarios.id }).from(scenarios).where(like(scenarios.name, `${scenarioPrefix}%`));
  return rows.map((row) => row.id);
};

const cleanup = async () => {
  const scenarioIds = await listScenarioIds();
  if (scenarioIds.length) {
    await db.delete(scenarioAdjustments).where(inArray(scenarioAdjustments.scenarioId, scenarioIds));
    await db.delete(scenarioAccounts).where(inArray(scenarioAccounts.scenarioId, scenarioIds));
    await db.delete(scenarios).where(inArray(scenarios.id, scenarioIds));
  }
  await db.delete(futureCommitments).where(like(futureCommitments.name, `${scenarioPrefix}%`));
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

const getScenarioByName = async (name: string) => {
  const [scenario] = await db.select().from(scenarios).where(eq(scenarios.name, name)).limit(1);
  if (!scenario) throw new Error(`Scenario not found: ${name}`);
  return scenario;
};

const countRows = async (checkingId: string) => {
  const [transactionRows, statementRows, accountRows] = await Promise.all([
    db.select({ id: transactions.id }).from(transactions).where(eq(transactions.accountId, checkingId)),
    db.select({ id: accountStatements.id }).from(accountStatements).where(eq(accountStatements.accountId, checkingId)),
    db.select({ id: accounts.id }).from(accounts)
  ]);
  return {
    transactions: transactionRows.length,
    statements: statementRows.length,
    accounts: accountRows.length
  };
};

const main = async () => {
  console.log("[step4] start");
  await cleanup();

  const checking = await Accounts.createAccount({
    name: `${accountPrefix} Checking`,
    type: "checking",
    startingInformation: { balance: "1000.00", date: "2026-01-01" }
  });
  const savings = await Accounts.createAccount({
    name: `${accountPrefix} Savings`,
    type: "savings",
    startingInformation: { balance: "300.00", date: "2026-01-01" }
  });

  await db.insert(users).values({
    email: testUserEmail,
    passwordHash: await bcrypt.hash(testPassword, 4),
    displayName: "Step 4 Smoke"
  });

  await db.insert(futureCommitments).values([
    {
      name: `${scenarioPrefix} Rent`,
      accountId: checking.id,
      amount: "-400.00",
      frequency: "monthly",
      nextDueDate: "2026-06-20",
      startDate: "2026-01-01",
      active: true
    }
  ]);

  const server = await startServer();
  try {
    const unauth = await fetch(`${server.baseUrl}/scenarios`, { redirect: "manual" });
    assert(unauth.status === 302 && unauth.headers.get("location") === "/login", "Scenario route should be mounted and require auth.");

    const cookie = await login(server.baseUrl);
    const listPage = await getHtml(`${server.baseUrl}/scenarios`, cookie);
    assert(listPage.response.status === 200 && listPage.html.includes("New Scenario"), "Authenticated GET /scenarios should load.");

    const newPage = await getHtml(`${server.baseUrl}/scenarios/new`, cookie);
    assert(newPage.response.status === 200 && newPage.html.includes("Save Scenario"), "Authenticated GET /scenarios/new should load.");

    const createResponse = await postForm(
      `${server.baseUrl}/scenarios`,
      cookie,
      new URLSearchParams({
        name: `${scenarioPrefix} Windfall`,
        description: "Extra income scenario",
        notes: "",
        active: "on"
      })
    );
    assert(createResponse.status === 302, "POST create scenario through HTTP should redirect.");
    const scenario = await getScenarioByName(`${scenarioPrefix} Windfall`);
    const createdLinks = await db.select().from(scenarioAccounts).where(eq(scenarioAccounts.scenarioId, scenario.id));
    assert(createdLinks.length === 0, "HTTP create should allow scenarios without account links.");

    const detail = await getHtml(`${server.baseUrl}/scenarios/${scenario.id}`, cookie);
    assert(detail.response.status === 200 && detail.html.includes("Add Scenario Item"), "Scenario detail should load as the planning workspace.");

    const edit = await getHtml(`${server.baseUrl}/scenarios/${scenario.id}/edit`, cookie);
    assert(edit.response.status === 200 && !edit.html.includes('name="accountIds"'), "Edit scenario page should not require account checkboxes.");

    await postForm(
      `${server.baseUrl}/scenarios/${scenario.id}`,
      cookie,
      new URLSearchParams({
        name: `${scenarioPrefix} Windfall`,
        description: "",
        notes: "",
        active: "on",
      })
    );
    let links = await db.select().from(scenarioAccounts).where(eq(scenarioAccounts.scenarioId, scenario.id));
    assert(links.length === 0, "HTTP update should preserve metadata-only scenario account model.");

    await postForm(
      `${server.baseUrl}/scenarios/${scenario.id}/items`,
      cookie,
      new URLSearchParams({
        name: "Bonus",
        accountId: checking.id,
        amount: "200.00",
        frequency: "once",
        nextDueDate: "2026-06-20",
        startDate: "2026-06-20",
        endDate: "2026-06-20",
        notes: "",
        payeeId: "",
        categoryId: "",
        active: "true"
      })
    );
    let items = await listScenarioCommitments(scenario.id);
    assert(items.length === 1 && items[0].accountName === `${accountPrefix} Checking`, "Add scenario item through HTTP should persist named account detail.");

    await postForm(
      `${server.baseUrl}/scenarios/${scenario.id}/items/${items[0].id}`,
      cookie,
      new URLSearchParams({
        name: "Bigger bonus",
        accountId: checking.id,
        amount: "225.00",
        frequency: "once",
        nextDueDate: "2026-06-21",
        startDate: "2026-06-21",
        endDate: "2026-06-21",
        notes: "",
        payeeId: "",
        categoryId: "",
        active: "true"
      })
    );
    items = await listScenarioCommitments(scenario.id);
    assert(items[0].amount === "225.00" && items[0].nextDueDate === "2026-06-21", "Edit scenario item through HTTP should update date and amount.");

    await postForm(`${server.baseUrl}/scenarios/${scenario.id}/items/${items[0].id}/archive`, cookie, new URLSearchParams());
    assert((await listScenarioCommitments(scenario.id))[0].active === false, "Archive scenario item through HTTP should retain but deactivate the row.");

    await createScenarioCommitment({
      scenarioId: scenario.id,
      name: "Bonus",
      accountId: checking.id,
      nextDueDate: "2026-06-20",
      startDate: "2026-06-20",
      endDate: "2026-06-20",
      frequency: "once",
      amount: "200.00",
    });
    const repair = await createScenario({
      name: `${scenarioPrefix} Car Repair`,
      description: "Expense scenario"
    });
    await createScenarioCommitment({
      scenarioId: repair.id,
      name: "Brake job",
      accountId: checking.id,
      nextDueDate: "2026-06-20",
      startDate: "2026-06-20",
      endDate: "2026-06-20",
      frequency: "once",
      amount: "-150.00",
    });
    const archived = await createScenario({
      name: `${scenarioPrefix} Archived`,
      description: "Archived scenario"
    });
    await createScenarioCommitment({
      scenarioId: archived.id,
      name: "Archived money",
      accountId: checking.id,
      nextDueDate: "2026-06-20",
      startDate: "2026-06-20",
      endDate: "2026-06-20",
      frequency: "once",
      amount: "999.00",
    });

    await postForm(`${server.baseUrl}/scenarios/${archived.id}/archive`, cookie, new URLSearchParams());
    const archivedScenario = await getScenarioByName(`${scenarioPrefix} Archived`);
    assert(archivedScenario.active === false, "Archive scenario through HTTP should mark it inactive.");

    const forecastOptions = await getHtml(`${server.baseUrl}/accounts/${checking.id}/forecast`, cookie);
    assert(forecastOptions.response.status === 200, "Forecast page should load with scenario options.");
    assert(forecastOptions.html.includes(`${scenarioPrefix} Windfall`), "Active scenario should be offered in forecast options.");
    assert(!forecastOptions.html.includes(`${scenarioPrefix} Archived`), "Archived scenario should be hidden from normal forecast options.");

    const beforeCounts = await countRows(checking.id);
    const baseline = await getAccountProjection(checking.id, { asOfDate: "2026-06-17", windowDays: 30 });
    assert(baseline?.mode === "baseline", "Forecast baseline should remain baseline without scenario IDs.");
    assert(!baseline?.items.some((item) => item.source === "scenario_commitment"), "Forecast baseline should have no scenario-only items.");

    const oneScenario = await getAccountProjection(checking.id, {
      asOfDate: "2026-06-17",
      windowDays: 30,
      scenarioIds: [scenario.id]
    });
    assert(oneScenario?.mode === "scenario", "Forecast with one active selected scenario should enter scenario mode.");
    assert(oneScenario?.items.some((item) => item.name === "Bonus"), "Forecast with one active scenario should include its scenario item.");

    const stacked = await getAccountProjection(checking.id, {
      asOfDate: "2026-06-17",
      windowDays: 30,
      scenarioIds: [scenario.id, repair.id]
    });
    assert(
      stacked?.items.filter((item) => item.source === "scenario_commitment").length === 2,
      "Forecast with two selected active scenarios should stack both scenario items."
    );

    const archivedProjection = await getAccountProjection(checking.id, {
      asOfDate: "2026-06-17",
      windowDays: 30,
      scenarioIds: [archived.id]
    });
    assert(archivedProjection?.mode === "baseline", "Passing an archived scenario ID should not enable scenario mode.");
    assert(!archivedProjection?.items.some((item) => item.name === "Archived money"), "Archived scenario items should not apply.");

    const afterCounts = await countRows(checking.id);
    assert(beforeCounts.transactions === afterCounts.transactions, "Projection calls should not mutate transaction count.");
    assert(beforeCounts.statements === afterCounts.statements, "Projection calls should not mutate statement count.");
    assert(beforeCounts.accounts === afterCounts.accounts, "Projection calls should not mutate account count.");

    const register = await getHtml(`${server.baseUrl}/accounts/${checking.id}/register`, cookie);
    assert(register.response.status === 200, "Register should still load.");
    assert(!register.html.includes("Scenario Adjustment") && !register.html.includes("Bonus"), "Register should remain free of generated scenario rows.");
  } finally {
    await server.close();
    await cleanup();
    await pool.end();
  }
};

main()
  .then(() => {
    console.log("[step4] complete");
  })
  .catch((error) => {
    console.error("[step4] failed", error);
    process.exitCode = 1;
  });
