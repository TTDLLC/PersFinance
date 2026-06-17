import { eq, inArray, like } from "drizzle-orm";
import { db, pool } from "../src/db/index.js";
import { accounts, accountStatements, futureCommitments, scenarioAccounts, scenarioAdjustments, scenarios, transactions, users } from "../src/db/schema.js";
import {
  archiveScenario,
  createScenario,
  createScenarioAdjustment,
  deleteScenarioAdjustment,
  getScenario,
  listScenarioAdjustments,
  listScenarios,
  updateScenario
} from "../src/services/scenarios.service.js";
import { getAccountProjection } from "../src/services/projections.service.js";
import { Accounts } from "../src/services/accounts.service.js";

const scenarioPrefix = "Step 4 Smoke Scenario";
const accountPrefix = "Step 4 Smoke";
const testUserEmail = "step4-smoke@example.com";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  console.log(`  [ok] ${message}`);
}

const cleanup = async () => {
  await db.delete(scenarioAdjustments).where(like(scenarioAdjustments.description, `Step 4%`));
  await db.delete(scenarioAccounts).where(inArray(scenarioAccounts.scenarioId, await listScenarioIds()));
  await db.delete(scenarios).where(like(scenarios.name, `${scenarioPrefix}%`));
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

const listScenarioIds = async () => {
  const rows = await db.select({ id: scenarios.id }).from(scenarios).where(like(scenarios.name, `${scenarioPrefix}%`));
  return rows.map((row) => row.id);
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

  await db.insert(users).values({ email: testUserEmail, passwordHash: "hash", displayName: "Step 4 Smoke" });

  await db.insert(futureCommitments).values([
    {
      name: `${scenarioPrefix} Rent`,
      accountId: checking.id,
      amount: "-400.00",
      frequency: "monthly",
      nextDueDate: "2026-02-01",
      startDate: "2026-01-01",
      active: true
    }
  ]);

  try {
    const scenario = await createScenario({
      name: `${scenarioPrefix} Windfall`,
      description: "Extra income scenario",
      accountIds: [checking.id]
    });
    assert(scenario.accountIds?.length === 1, "Create scenario should return linked account count.");
    assert((await listScenarios()).length === 1, "Scenario list should include the new scenario.");

    await createScenarioAdjustment({
      scenarioId: scenario.id,
      accountId: checking.id,
      date: "2026-02-01",
      amount: "200.00",
      description: "Bonus",
      notes: "Test bonus"
    });
    const adjustments = await listScenarioAdjustments(scenario.id);
    assert(adjustments.length === 1, "Adjustment list should include the created adjustment.");
    assert(adjustments[0].amount === "200.00", "Adjustment amount should be preserved.");

    const archived = await archiveScenario(scenario.id);
    assert(archived.active === false, "Archived scenario should be inactive.");
    assert((await listScenarios({ includeInactive: false })).length === 0, "Default scenario list should hide archived scenarios.");
    assert((await listScenarios({ includeInactive: true })).length === 1, "Include inactive scenario list should show archived scenarios.");

    const restored = await updateScenario(scenario.id, { active: true, accountIds: [checking.id, savings.id] });
    assert(restored.active === true, "Restored scenario should be active.");
    const accountLinks = await db.select().from(scenarioAccounts).where(eq(scenarioAccounts.scenarioId, scenario.id));
    assert(accountLinks.length === 2, "Scenario should include both accounts after update.");
    assert(new Set(accountLinks.map((row) => row.accountId)).has(savings.id), "Scenario should include savings account after update.");

    const baseline = await getAccountProjection(checking.id, { asOfDate: "2026-01-15", windowDays: 30 });
    assert(baseline, "Baseline projection should load.");
    assert(baseline.mode === "baseline", "Default mode should be baseline without scenario IDs.");
    assert(baseline.items.some((item) => item.source === "future_commitment"), "Baseline should include commitments.");

    const scenarioProjection = await getAccountProjection(checking.id, {
      asOfDate: "2026-01-15",
      windowDays: 30,
      scenarioIds: [scenario.id]
    });
    assert(scenarioProjection?.mode === "scenario", "Projection mode should be scenario when IDs are selected.");
    assert(scenarioProjection?.items.some((item) => item.source === "scenario_adjustment"), "Selected scenario adjustments should appear in projection.");
    assert(
      Number(scenarioProjection?.projectedEndingBalance ?? 0) > Number(baseline.projectedEndingBalance ?? 0),
      "Scenario overlay should increase ending balance when positive adjustment is applied."
    );

    const multiScenario = await createScenario({
      name: `${scenarioPrefix} Car Repair`,
      description: "Expense scenario",
      accountIds: [checking.id]
    });
    await createScenarioAdjustment({
      scenarioId: multiScenario.id,
      accountId: checking.id,
      date: "2026-02-05",
      amount: "-150.00",
      description: "Brake job"
    });

    const stacked = await getAccountProjection(checking.id, {
      asOfDate: "2026-01-15",
      windowDays: 30,
      scenarioIds: [scenario.id, multiScenario.id]
    });
    assert(stacked?.mode === "scenario", "Stacked projection should remain scenario mode.");
    assert(
      stacked?.items.filter((item) => item.source === "scenario_adjustment").length === 2,
      "Stacked projection should include adjustments from both scenarios."
    );

    const [adjustment] = await listScenarioAdjustments(multiScenario.id);
    await deleteScenarioAdjustment(adjustment.id);
    assert((await listScenarioAdjustments(multiScenario.id)).length === 0, "Deleted adjustment should not remain.");
  } finally {
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
