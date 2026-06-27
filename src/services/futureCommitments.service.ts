import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { aliasedTable } from "drizzle-orm/alias";
import { db } from "../db/index.js";
import { accounts, categories, futureCommitments, payees, scenarios, transactions } from "../db/schema.js";
import { createTransferRows } from "./transfers.service.js";

export type CommitmentFrequency = typeof futureCommitments.$inferSelect.frequency;
export type CommitmentKind = typeof futureCommitments.$inferSelect.kind;
export type CommitmentFilters = {
  payeeId?: string;
  accountId?: string;
};

const toMoney = (value: number) => value.toFixed(2);
export const isoToday = () => new Date().toISOString().slice(0, 10);

const addMonths = (date: string, months: number) => {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
};

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

export const advanceDueDate = (date: string, frequency: CommitmentFrequency) => {
  if (frequency === "weekly") return addDays(date, 7);
  if (frequency === "biweekly") return addDays(date, 14);
  if (frequency === "monthly") return addMonths(date, 1);
  if (frequency === "quarterly") return addMonths(date, 3);
  if (frequency === "yearly") return addMonths(date, 12);
  return null;
};

const transferFromAccounts = aliasedTable(accounts, "transfer_from_accounts");
const transferToAccounts = aliasedTable(accounts, "transfer_to_accounts");

const accountFilter = (accountId: string) =>
  or(
    eq(futureCommitments.accountId, accountId),
    eq(futureCommitments.transferFromAccountId, accountId),
    eq(futureCommitments.transferToAccountId, accountId)
  );

type NormalizableCommitmentInput = Omit<typeof futureCommitments.$inferInsert, "amount"> & {
  amount: number | string;
};

export const normalizeCommitmentValues = (input: NormalizableCommitmentInput): typeof futureCommitments.$inferInsert => {
  const kind = input.kind ?? "transaction";
  if (kind === "transfer") {
    return {
      ...input,
      kind,
      accountId: null,
      categoryId: null,
      amount: typeof input.amount === "number" ? toMoney(input.amount) : input.amount
    };
  }
  return {
    ...input,
    kind,
    transferFromAccountId: null,
    transferToAccountId: null,
    amount: typeof input.amount === "number" ? toMoney(input.amount) : input.amount
  };
};

export const listCommitments = async (showAll = false, today = isoToday(), filters: CommitmentFilters = {}) => {
  const conditions = [
    eq(futureCommitments.includeInBaseline, true),
    showAll ? undefined : eq(futureCommitments.active, true),
    showAll ? undefined : or(isNull(futureCommitments.endDate), gte(futureCommitments.endDate, today))
  ];
  if (filters.payeeId) conditions.push(eq(futureCommitments.payeeId, filters.payeeId));
  if (filters.accountId) conditions.push(accountFilter(filters.accountId)!);

  return db
    .select({
      id: futureCommitments.id,
      kind: futureCommitments.kind,
      name: futureCommitments.name,
      payeeId: futureCommitments.payeeId,
      payeeName: payees.name,
      categoryId: futureCommitments.categoryId,
      categoryName: categories.name,
      accountId: futureCommitments.accountId,
      accountName: accounts.name,
      transferFromAccountId: futureCommitments.transferFromAccountId,
      transferFromAccountName: transferFromAccounts.name,
      transferToAccountId: futureCommitments.transferToAccountId,
      transferToAccountName: transferToAccounts.name,
      amount: futureCommitments.amount,
      frequency: futureCommitments.frequency,
      nextDueDate: futureCommitments.nextDueDate,
      startDate: futureCommitments.startDate,
      endDate: futureCommitments.endDate,
      notes: futureCommitments.notes,
      active: futureCommitments.active,
      scenarioId: futureCommitments.scenarioId,
      includeInBaseline: futureCommitments.includeInBaseline,
      scenarioName: scenarios.name
    })
    .from(futureCommitments)
    .leftJoin(payees, eq(futureCommitments.payeeId, payees.id))
    .leftJoin(categories, eq(futureCommitments.categoryId, categories.id))
    .leftJoin(accounts, eq(futureCommitments.accountId, accounts.id))
    .leftJoin(transferFromAccounts, eq(futureCommitments.transferFromAccountId, transferFromAccounts.id))
    .leftJoin(transferToAccounts, eq(futureCommitments.transferToAccountId, transferToAccounts.id))
    .leftJoin(scenarios, eq(futureCommitments.scenarioId, scenarios.id))
    .where(and(...conditions))
    .orderBy(asc(futureCommitments.nextDueDate), asc(futureCommitments.name));
};

export const getCommitment = async (id: string, options?: { baselineOnly?: boolean }) => {
  const filters = [eq(futureCommitments.id, id)];
  if (options?.baselineOnly) filters.push(eq(futureCommitments.includeInBaseline, true));
  const [row] = await db.select().from(futureCommitments).where(and(...filters)).limit(1);
  return row ?? null;
};

export const getOverdueCommitments = async (accountId?: string, today = isoToday()) => {
  const filters = [
    eq(futureCommitments.includeInBaseline, true),
    eq(futureCommitments.active, true),
    lte(futureCommitments.nextDueDate, today),
    or(isNull(futureCommitments.endDate), lte(futureCommitments.nextDueDate, futureCommitments.endDate))!
  ];
  if (accountId) filters.push(accountFilter(accountId)!);
  return db.select().from(futureCommitments).where(and(...filters)).orderBy(asc(futureCommitments.nextDueDate));
};

export const enterCommitment = async (
  commitmentId: string,
  input: { accountId?: string | null; date: string; amount: number; notes?: string | null }
) =>
  db.transaction(async (tx) => {
    const [commitment] = await tx.select().from(futureCommitments).where(eq(futureCommitments.id, commitmentId)).limit(1);
    if (!commitment || !commitment.active) throw new Error("Active commitment not found.");
    if (!commitment.includeInBaseline) throw new Error("Scenario-only commitments cannot be entered into the register.");

    if (commitment.kind === "transfer") {
      if (!commitment.transferFromAccountId || !commitment.transferToAccountId) {
        throw new Error("Transfer commitments require from and to accounts.");
      }
      const transferId = await createTransferRows(tx, {
        date: input.date,
        amount: input.amount,
        sourceAccountId: commitment.transferFromAccountId,
        destinationAccountId: commitment.transferToAccountId,
        status: "entered",
        notes: input.notes ?? commitment.notes
      });

      const nextDueDate = advanceDueDate(commitment.nextDueDate, commitment.frequency);
      const remainsActive = Boolean(nextDueDate && (!commitment.endDate || nextDueDate <= commitment.endDate));
      await tx
        .update(futureCommitments)
        .set({
          nextDueDate: nextDueDate ?? commitment.nextDueDate,
          active: remainsActive,
          updatedAt: new Date()
        })
        .where(eq(futureCommitments.id, commitment.id));

      return { id: transferId, transferId, accountId: commitment.transferFromAccountId };
    }

    if (!input.accountId) throw new Error("An active account is required.");
    const [account] = await tx.select().from(accounts).where(and(eq(accounts.id, input.accountId), eq(accounts.active, true))).limit(1);
    if (!account) throw new Error("An active account is required.");

    const [transaction] = await tx
      .insert(transactions)
      .values({
        accountId: account.id,
        date: input.date,
        amount: toMoney(input.amount),
        status: "entered",
        payeeId: commitment.payeeId,
        categoryId: commitment.categoryId,
        description: commitment.name,
        notes: input.notes ?? commitment.notes
      })
      .returning({ id: transactions.id, accountId: transactions.accountId });

    const nextDueDate = advanceDueDate(commitment.nextDueDate, commitment.frequency);
    const remainsActive = Boolean(nextDueDate && (!commitment.endDate || nextDueDate <= commitment.endDate));
    await tx
      .update(futureCommitments)
      .set({
        nextDueDate: nextDueDate ?? commitment.nextDueDate,
        active: remainsActive,
        updatedAt: new Date()
      })
      .where(eq(futureCommitments.id, commitment.id));

    return transaction;
  });

export type ScenarioCommitmentInput = {
  scenarioId: string;
  name: string;
  payeeId?: string | null;
  categoryId?: string | null;
  accountId?: string | null;
  kind?: CommitmentKind;
  transferFromAccountId?: string | null;
  transferToAccountId?: string | null;
  amount: number | string;
  frequency: CommitmentFrequency;
  nextDueDate: string;
  startDate: string;
  endDate?: string | null;
  notes?: string | null;
  active?: boolean;
};

export const listScenarioCommitments = async (scenarioId: string) =>
  db
    .select({
      id: futureCommitments.id,
      kind: futureCommitments.kind,
      name: futureCommitments.name,
      payeeId: futureCommitments.payeeId,
      payeeName: payees.name,
      categoryId: futureCommitments.categoryId,
      categoryName: categories.name,
      accountId: futureCommitments.accountId,
      accountName: accounts.name,
      transferFromAccountId: futureCommitments.transferFromAccountId,
      transferFromAccountName: transferFromAccounts.name,
      transferToAccountId: futureCommitments.transferToAccountId,
      transferToAccountName: transferToAccounts.name,
      amount: futureCommitments.amount,
      frequency: futureCommitments.frequency,
      nextDueDate: futureCommitments.nextDueDate,
      startDate: futureCommitments.startDate,
      endDate: futureCommitments.endDate,
      notes: futureCommitments.notes,
      active: futureCommitments.active,
      scenarioId: futureCommitments.scenarioId,
      includeInBaseline: futureCommitments.includeInBaseline,
      createdAt: futureCommitments.createdAt,
      updatedAt: futureCommitments.updatedAt
    })
    .from(futureCommitments)
    .leftJoin(payees, eq(futureCommitments.payeeId, payees.id))
    .leftJoin(categories, eq(futureCommitments.categoryId, categories.id))
    .leftJoin(accounts, eq(futureCommitments.accountId, accounts.id))
    .leftJoin(transferFromAccounts, eq(futureCommitments.transferFromAccountId, transferFromAccounts.id))
    .leftJoin(transferToAccounts, eq(futureCommitments.transferToAccountId, transferToAccounts.id))
    .where(eq(futureCommitments.scenarioId, scenarioId))
    .orderBy(desc(futureCommitments.active), asc(futureCommitments.nextDueDate), asc(futureCommitments.name));

export const listScenarioAccounts = async (scenarioId: string) =>
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
    .orderBy(accounts.name);

export const getScenarioCommitment = async (scenarioId: string, commitmentId: string) => {
  const [row] = await db
    .select()
    .from(futureCommitments)
    .where(and(eq(futureCommitments.scenarioId, scenarioId), eq(futureCommitments.id, commitmentId)))
    .limit(1);
  return row ?? null;
};

export const createScenarioCommitment = async (input: ScenarioCommitmentInput) =>
  db
    .insert(futureCommitments)
    .values({
      ...normalizeCommitmentValues(input),
      includeInBaseline: false,
      active: input.active ?? true
    })
    .returning();

export const updateScenarioCommitment = async (scenarioId: string, commitmentId: string, input: Omit<ScenarioCommitmentInput, "scenarioId">) =>
  db
    .update(futureCommitments)
    .set({
      ...normalizeCommitmentValues(input),
      scenarioId,
      updatedAt: new Date()
    })
    .where(and(eq(futureCommitments.scenarioId, scenarioId), eq(futureCommitments.id, commitmentId)))
    .returning();

export const archiveScenarioCommitment = async (scenarioId: string, commitmentId: string) =>
  db
    .update(futureCommitments)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(futureCommitments.scenarioId, scenarioId), eq(futureCommitments.id, commitmentId)))
    .returning();

export const promoteScenarioCommitment = async (scenarioId: string, commitmentId: string) =>
  db
    .update(futureCommitments)
    .set({ includeInBaseline: true, updatedAt: new Date() })
    .where(
      and(
        eq(futureCommitments.scenarioId, scenarioId),
        eq(futureCommitments.id, commitmentId),
        eq(futureCommitments.includeInBaseline, false)
      )
    )
    .returning();
