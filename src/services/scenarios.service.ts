import {
  and,
  asc,
  desc,
  eq,
  inArray,
  or,
  SQL
} from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  accounts,
  categories,
  futureCommitments,
  payees,
  scenarioAccounts,
  scenarioAdjustments,
  scenarios
} from "../db/schema.js";

export type Scenario = typeof scenarios.$inferSelect;
export type NewScenario = typeof scenarios.$inferInsert;
export type ScenarioAdjustment = typeof scenarioAdjustments.$inferSelect;
export type NewScenarioAdjustment = typeof scenarioAdjustments.$inferInsert;

const compactUnique = (values: string[] | undefined) => [...new Set((values ?? []).filter(Boolean))];

const nullableText = (value: unknown) => {
  const trimmed = String(value ?? "").trim();
  return trimmed.length ? trimmed : null;
};

const requireScenario = async (scenarioId: string) => {
  const scenario = await getScenario(scenarioId);
  if (!scenario) throw new Error("Scenario not found.");
  return scenario;
};

const requireScenarioAccount = async (scenarioId: string, accountId: string) => {
  const [link] = await db
    .select({ accountId: scenarioAccounts.accountId })
    .from(scenarioAccounts)
    .where(and(eq(scenarioAccounts.scenarioId, scenarioId), eq(scenarioAccounts.accountId, accountId)))
    .limit(1);
  if (!link) throw new Error("Adjustment account must be linked to the scenario.");
};

const normalizeAdjustmentInput = (input: NewScenarioAdjustment | Partial<NewScenarioAdjustment>) => {
  const normalized = {
    ...input,
    payeeId: nullableText(input.payeeId),
    categoryId: nullableText(input.categoryId),
    description: nullableText(input.description),
    notes: nullableText(input.notes)
  };
  if ("date" in input && !nullableText(input.date)) throw new Error("Adjustment date is required.");
  if ("amount" in input) {
    const amount = nullableText(input.amount);
    if (!amount) throw new Error("Adjustment amount is required.");
    if (Number(amount) === 0) throw new Error("Adjustment amount must be non-zero.");
    normalized.amount = amount;
  }
  return normalized;
};

export const listScenarios = async (options?: { includeInactive?: boolean }) => {
  const baseWhere: SQL[] = [];
  if (!options?.includeInactive) baseWhere.push(eq(scenarios.active, true));

  return Promise.all([
    db.select().from(scenarios).where(baseWhere.length ? and(...baseWhere) : undefined).orderBy(desc(scenarios.updatedAt)),
    db
      .select({ scenarioId: futureCommitments.scenarioId, accountCount: sql<number>`count(distinct ${futureCommitments.accountId})::int` })
      .from(futureCommitments)
      .where(sql`${futureCommitments.scenarioId} is not null and ${futureCommitments.accountId} is not null`)
      .groupBy(futureCommitments.scenarioId)
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
  if (!scenario) return null;
  const links = await db
    .select({ accountId: scenarioAccounts.accountId })
    .from(scenarioAccounts)
    .where(eq(scenarioAccounts.scenarioId, id))
    .orderBy(scenarioAccounts.accountId);
  return { ...scenario, accountIds: links.map((link) => link.accountId) };
};

export const createScenario = async (input: NewScenario & { accountIds?: string[] }) => {
  const { accountIds, ...scenarioData } = input;
  const linkedAccountIds = compactUnique(accountIds);

  const created = await db.transaction(async (tx) => {
    const [scenario] = await tx.insert(scenarios).values({ ...scenarioData, active: scenarioData.active ?? true }).returning();
    if (linkedAccountIds.length) {
      await tx.insert(scenarioAccounts).values(linkedAccountIds.map((accountId) => ({ scenarioId: scenario.id, accountId })));
    }
    return scenario;
  });

  return { ...created, accountIds: linkedAccountIds };
};

export const updateScenario = async (id: string, input: Partial<NewScenario> & { accountIds?: string[] }) => {
  const { accountIds, ...scenarioData } = input;
  const linkedAccountIds = accountIds === undefined ? undefined : compactUnique(accountIds);

  const updated = await db.transaction(async (tx) => {
    const [scenario] = await tx
      .update(scenarios)
      .set({ ...scenarioData, updatedAt: new Date() })
      .where(eq(scenarios.id, id))
      .returning();

    if (accountIds !== undefined) {
      await tx.delete(scenarioAccounts).where(eq(scenarioAccounts.scenarioId, id));
      if (linkedAccountIds?.length) {
        await tx.insert(scenarioAccounts).values(linkedAccountIds.map((accountId) => ({ scenarioId: scenario.id, accountId })));
      }
    }

    return scenario;
  });

  return { ...updated, accountIds: linkedAccountIds ?? [] };
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
      accountName: accounts.name,
      date: scenarioAdjustments.date,
      amount: scenarioAdjustments.amount,
      payeeId: scenarioAdjustments.payeeId,
      categoryId: scenarioAdjustments.categoryId,
      description: scenarioAdjustments.description,
      notes: scenarioAdjustments.notes,
      payeeName: payees.name,
      categoryName: categories.name,
      createdAt: scenarioAdjustments.createdAt,
      updatedAt: scenarioAdjustments.updatedAt
    })
    .from(scenarioAdjustments)
    .innerJoin(accounts, eq(scenarioAdjustments.accountId, accounts.id))
    .leftJoin(payees, eq(scenarioAdjustments.payeeId, payees.id))
    .leftJoin(categories, eq(scenarioAdjustments.categoryId, categories.id))
    .where(and(...conditions))
    .orderBy(asc(scenarioAdjustments.date), asc(scenarioAdjustments.createdAt));
};

export const getScenarioAccountOptions = async (scenarioId: string) =>
  Promise.all([
    db
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type
      })
      .from(scenarioAccounts)
      .innerJoin(accounts, eq(scenarioAccounts.accountId, accounts.id))
      .where(and(eq(scenarioAccounts.scenarioId, scenarioId), eq(accounts.active, true))),
    db
      .selectDistinct({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type
      })
      .from(futureCommitments)
      .innerJoin(
        accounts,
        or(
          eq(futureCommitments.accountId, accounts.id),
          eq(futureCommitments.transferFromAccountId, accounts.id),
          eq(futureCommitments.transferToAccountId, accounts.id)
        )
      )
      .where(and(eq(futureCommitments.scenarioId, scenarioId), eq(accounts.active, true)))
  ]).then(([linkedRows, commitmentRows]) => {
    const byId = new Map([...linkedRows, ...commitmentRows].map((account) => [account.id, account]));
    return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
  });

export const getScenarioAdjustment = async (scenarioId: string, adjustmentId: string) => {
  const [adjustment] = await db
    .select()
    .from(scenarioAdjustments)
    .where(and(eq(scenarioAdjustments.scenarioId, scenarioId), eq(scenarioAdjustments.id, adjustmentId)))
    .limit(1);
  return adjustment ?? null;
};

export const createScenarioAdjustment = async (input: NewScenarioAdjustment) => {
  await requireScenario(input.scenarioId);
  if (!input.accountId) throw new Error("Adjustment account is required.");
  await requireScenarioAccount(input.scenarioId, input.accountId);
  const values = normalizeAdjustmentInput(input) as NewScenarioAdjustment;
  return db
    .insert(scenarioAdjustments)
    .values(values)
    .returning();
};

export const updateScenarioAdjustment = async (scenarioId: string, id: string, input: Partial<NewScenarioAdjustment>) => {
  await requireScenario(scenarioId);
  const existing = await getScenarioAdjustment(scenarioId, id);
  if (!existing) throw new Error("Adjustment not found.");
  const accountId = input.accountId ?? existing.accountId;
  if (!accountId) throw new Error("Adjustment account is required.");
  await requireScenarioAccount(scenarioId, accountId);
  const values = normalizeAdjustmentInput(input) as Partial<NewScenarioAdjustment>;
  return db
    .update(scenarioAdjustments)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(scenarioAdjustments.scenarioId, scenarioId), eq(scenarioAdjustments.id, id)))
    .returning();
};

export const deleteScenarioAdjustment = async (scenarioId: string, id: string) =>
  db
    .delete(scenarioAdjustments)
    .where(and(eq(scenarioAdjustments.scenarioId, scenarioId), eq(scenarioAdjustments.id, id)))
    .returning();

export const listActiveScenarioIdsForAccount = async (accountId: string, scenarioIds: string[]) => {
  const selectedIds = compactUnique(scenarioIds);
  if (!selectedIds.length) return [];
  const rows = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .innerJoin(futureCommitments, eq(futureCommitments.scenarioId, scenarios.id))
    .where(
      and(
        eq(scenarios.active, true),
        or(
          eq(futureCommitments.accountId, accountId),
          eq(futureCommitments.transferFromAccountId, accountId),
          eq(futureCommitments.transferToAccountId, accountId)
        ),
        inArray(scenarios.id, selectedIds),
        eq(futureCommitments.includeInBaseline, false),
        eq(futureCommitments.active, true)
      )
    )
    .orderBy(scenarios.name);
  const accepted = new Set(rows.map((row) => row.id));
  return selectedIds.filter((id) => accepted.has(id));
};
