import {
  and,
  asc,
  count,
  desc,
  eq,
  SQL
} from "drizzle-orm";
import { db } from "../db/index.js";
import {
  accounts,
  categories,
  payees,
  scenarioAccounts,
  scenarioAdjustments,
  scenarios
} from "../db/schema.js";

export type Scenario = typeof scenarios.$inferSelect;
export type NewScenario = typeof scenarios.$inferInsert;
export type ScenarioAdjustment = typeof scenarioAdjustments.$inferSelect;
export type NewScenarioAdjustment = typeof scenarioAdjustments.$inferInsert;

export const listScenarios = async (options?: { includeInactive?: boolean }) => {
  const baseWhere: SQL[] = [];
  if (!options?.includeInactive) baseWhere.push(eq(scenarios.active, true));

  return Promise.all([
    db.select().from(scenarios).where(baseWhere.length ? and(...baseWhere) : undefined).orderBy(desc(scenarios.updatedAt)),
    db.select({ scenarioId: scenarioAccounts.scenarioId, accountCount: count() }).from(scenarioAccounts).groupBy(scenarioAccounts.scenarioId)
  ]).then(([rows, counts]) => {
    const countsByScenario = new Map(counts.map((item) => [item.scenarioId, Number(item.accountCount)]));
    return rows.map((scenario) => ({
      ...scenario,
      accountCount: countsByScenario.get(scenario.id) ?? 0
    }));
  });
};

export const getScenario = async (id: string) => {
  const [scenario] = await db.select().from(scenarios).where(eq(scenarios.id, id)).limit(1);
  return scenario ?? null;
};

export const createScenario = async (input: NewScenario & { accountIds?: string[] }) => {
  const { accountIds = [], ...scenarioData } = input;

  const created = await db.transaction(async (tx) => {
    const [scenario] = await tx.insert(scenarios).values({ ...scenarioData, active: true }).returning();
    if (accountIds.length) {
      await tx.insert(scenarioAccounts).values(accountIds.map((accountId) => ({ scenarioId: scenario.id, accountId })));
    }
    return scenario;
  });

  return { ...created, accountIds };
};

export const updateScenario = async (id: string, input: Partial<NewScenario> & { accountIds?: string[] }) => {
  const { accountIds, ...scenarioData } = input;

  const updated = await db.transaction(async (tx) => {
    const [scenario] = await tx
      .update(scenarios)
      .set({ ...scenarioData, updatedAt: new Date() })
      .where(eq(scenarios.id, id))
      .returning();

    if (accountIds !== undefined) {
      await tx.delete(scenarioAccounts).where(eq(scenarioAccounts.scenarioId, id));
      if (accountIds.length) {
        await tx.insert(scenarioAccounts).values(accountIds.map((accountId) => ({ scenarioId: scenario.id, accountId })));
      }
    }

    return scenario;
  });

  return { ...updated, accountIds: accountIds ?? [] };
};

export const archiveScenario = async (id: string) => {
  const [existing] = await db.select().from(scenarios).where(eq(scenarios.id, id)).limit(1);
  if (!existing) throw new Error("Scenario not found.");

  const [scenario] = await db
    .update(scenarios)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(scenarios.id, id))
    .returning();

  return scenario;
};

export const listScenarioAdjustments = async (scenarioId: string, options?: { accountId?: string }) => {
  const conditions = [eq(scenarioAdjustments.scenarioId, scenarioId)];
  if (options?.accountId) conditions.push(eq(scenarioAdjustments.accountId, options.accountId));

  return db
    .select({
      id: scenarioAdjustments.id,
      scenarioId: scenarioAdjustments.scenarioId,
      accountId: scenarioAdjustments.accountId,
      date: scenarioAdjustments.date,
      amount: scenarioAdjustments.amount,
      payeeId: scenarioAdjustments.payeeId,
      categoryId: scenarioAdjustments.categoryId,
      description: scenarioAdjustments.description,
      notes: scenarioAdjustments.notes,
      createdAt: scenarioAdjustments.createdAt,
      updatedAt: scenarioAdjustments.updatedAt
    })
    .from(scenarioAdjustments)
    .leftJoin(payees, eq(scenarioAdjustments.payeeId, payees.id))
    .leftJoin(categories, eq(scenarioAdjustments.categoryId, categories.id))
    .where(and(...conditions))
    .orderBy(asc(scenarioAdjustments.date), asc(scenarioAdjustments.createdAt));
};

export const createScenarioAdjustment = async (input: NewScenarioAdjustment) =>
  db
    .insert(scenarioAdjustments)
    .values(input)
    .returning();

export const updateScenarioAdjustment = async (id: string, input: Partial<NewScenarioAdjustment>) =>
  db
    .update(scenarioAdjustments)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(scenarioAdjustments.id, id))
    .returning();

export const deleteScenarioAdjustment = async (id: string) =>
  db
    .delete(scenarioAdjustments)
    .where(eq(scenarioAdjustments.id, id))
    .returning();
