import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, categories, futureCommitments, payees, transactions } from "../db/schema.js";

export type CommitmentFrequency = typeof futureCommitments.$inferSelect.frequency;

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

const visibleCutoff = (today: string) => addDays(today, -60);

export const listCommitments = async (showAll = false, today = isoToday()) =>
  db
    .select({
      id: futureCommitments.id,
      name: futureCommitments.name,
      payeeId: futureCommitments.payeeId,
      payeeName: payees.name,
      categoryId: futureCommitments.categoryId,
      categoryName: categories.name,
      accountId: futureCommitments.accountId,
      accountName: accounts.name,
      amount: futureCommitments.amount,
      frequency: futureCommitments.frequency,
      nextDueDate: futureCommitments.nextDueDate,
      startDate: futureCommitments.startDate,
      endDate: futureCommitments.endDate,
      notes: futureCommitments.notes,
      active: futureCommitments.active
    })
    .from(futureCommitments)
    .leftJoin(payees, eq(futureCommitments.payeeId, payees.id))
    .leftJoin(categories, eq(futureCommitments.categoryId, categories.id))
    .leftJoin(accounts, eq(futureCommitments.accountId, accounts.id))
    .where(showAll ? undefined : or(isNull(futureCommitments.endDate), gte(futureCommitments.endDate, visibleCutoff(today))))
    .orderBy(asc(futureCommitments.nextDueDate), asc(futureCommitments.name));

export const getCommitment = async (id: string) => {
  const [row] = await db.select().from(futureCommitments).where(eq(futureCommitments.id, id)).limit(1);
  return row ?? null;
};

export const getOverdueCommitments = async (accountId?: string, today = isoToday()) => {
  const filters = [
    eq(futureCommitments.active, true),
    lte(futureCommitments.nextDueDate, today),
    or(isNull(futureCommitments.endDate), lte(futureCommitments.nextDueDate, futureCommitments.endDate))!
  ];
  if (accountId) filters.push(eq(futureCommitments.accountId, accountId));
  return db.select().from(futureCommitments).where(and(...filters)).orderBy(asc(futureCommitments.nextDueDate));
};

export const enterCommitment = async (
  commitmentId: string,
  input: { accountId: string; date: string; amount: number; notes?: string | null }
) =>
  db.transaction(async (tx) => {
    const [commitment] = await tx.select().from(futureCommitments).where(eq(futureCommitments.id, commitmentId)).limit(1);
    if (!commitment || !commitment.active) throw new Error("Active commitment not found.");

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
      .returning({ id: transactions.id });

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
