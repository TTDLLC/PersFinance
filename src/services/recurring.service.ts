import { and, eq, gt, lte } from "drizzle-orm";
import { db } from "../db/index.js";
import { transactions } from "../db/schema.js";

export const recurringScheduleLabels: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  semimonthly: "Semimonthly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
  custom: "Custom"
};

type DbClient = typeof db;
type TransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];
type RecurringClient = DbClient | TransactionClient;
type RegisterTransaction = typeof transactions.$inferSelect;
type RegisterTransactionStatus = RegisterTransaction["status"];
type RecurringEditScope = "this" | "future";

const supportedFrequencies = new Set(["weekly", "biweekly", "monthly", "quarterly", "yearly"]);
const historicalStatuses = new Set<RegisterTransactionStatus>(["entered", "pending", "cleared", "statement", "void"]);

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);
const parseIsoDate = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
};
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const clampDay = (year: number, month: number, day: number) => Math.min(day, daysInMonth(year, month));

const addDays = (date: string, days: number) => {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return toIsoDate(next);
};

const addMonths = (date: string, months: number, preferredDay?: number | null) => {
  const parsed = parseIsoDate(date);
  const firstOfTargetMonth = new Date(Date.UTC(parsed.year, parsed.month - 1 + months, 1));
  const year = firstOfTargetMonth.getUTCFullYear();
  const month = firstOfTargetMonth.getUTCMonth() + 1;
  const day = clampDay(year, month, preferredDay ?? parsed.day);
  return toIsoDate(new Date(Date.UTC(year, month - 1, day)));
};

export const calculateNextRecurringDate = (transaction: Pick<RegisterTransaction, "date" | "frequency" | "dayOfMonth">) => {
  switch (transaction.frequency) {
    case "weekly":
      return addDays(transaction.date, 7);
    case "biweekly":
      return addDays(transaction.date, 14);
    case "monthly":
      return addMonths(transaction.date, 1, transaction.dayOfMonth);
    case "quarterly":
      return addMonths(transaction.date, 3, transaction.dayOfMonth);
    case "yearly":
      return addMonths(transaction.date, 12, transaction.dayOfMonth);
    default:
      return null;
  }
};

const hasRecurringMetadata = (transaction: RegisterTransaction) =>
  Boolean(transaction.recurringGroupId && transaction.frequency && supportedFrequencies.has(transaction.frequency));

const findFutureRecurringOccurrence = async (
  client: RecurringClient,
  recurringGroupId: string,
  scheduledDate: string
) => {
  const [existing] = await client
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.recurringGroupId, recurringGroupId),
        eq(transactions.date, scheduledDate),
        eq(transactions.status, "recurring")
      )
    )
    .limit(1);
  return existing ?? null;
};

export const ensureNextRecurringOccurrence = async (client: RecurringClient, source: RegisterTransaction) => {
  if (!hasRecurringMetadata(source) || !source.recurringGroupId) return null;

  const nextDate = calculateNextRecurringDate(source);
  if (!nextDate) return null;
  if (source.recurringEndDate && nextDate > source.recurringEndDate) return null;

  // TODO: add a partial unique constraint for (recurring_group_id, date) where status = 'recurring'.
  const duplicate = await findFutureRecurringOccurrence(client, source.recurringGroupId, nextDate);
  if (duplicate) return duplicate;

  const [created] = await client
    .insert(transactions)
    .values({
      accountId: source.accountId,
      categoryId: source.categoryId,
      date: nextDate,
      description: source.description,
      amount: source.amount,
      transactionType: source.transactionType,
      status: "recurring",
      amountType: source.amountType,
      paymentMethod: source.paymentMethod,
      recurringGroupId: source.recurringGroupId,
      frequency: source.frequency,
      recurringEndDate: source.recurringEndDate,
      dayOfMonth: source.dayOfMonth,
      secondDayOfMonth: source.secondDayOfMonth,
      source: source.source,
      sourceRowHash: source.sourceRowHash,
      notes: source.notes
    })
    .returning({ id: transactions.id });

  return created ?? null;
};

export const processDueRecurringTransactions = async (accountId: string, today = toIsoDate(new Date())) =>
  db.transaction(async (tx) => {
    let processedCount = 0;

    for (;;) {
      const [dueTransaction] = await tx
        .select()
        .from(transactions)
        .where(and(eq(transactions.accountId, accountId), eq(transactions.status, "recurring"), lte(transactions.date, today)))
        .orderBy(transactions.date, transactions.id)
        .limit(1);

      if (!dueTransaction) break;

      await tx
        .update(transactions)
        .set({ status: "entered", updatedAt: new Date() })
        .where(eq(transactions.id, dueTransaction.id));
      await ensureNextRecurringOccurrence(tx, { ...dueTransaction, status: "entered" });
      processedCount += 1;
    }

    return processedCount;
  });

export const updateRecurringTransactionWithLifecycle = async (
  transaction: RegisterTransaction,
  values: Partial<typeof transactions.$inferInsert>,
  scope: RecurringEditScope = "this"
) =>
  db.transaction(async (tx) => {
    await tx.update(transactions).set({ ...values, updatedAt: new Date() }).where(eq(transactions.id, transaction.id));

    const nextStatus = values.status ?? transaction.status;
    const updatedTransaction = { ...transaction, ...values, status: nextStatus } as RegisterTransaction;
    if (transaction.status === "recurring" && nextStatus !== "recurring") {
      await ensureNextRecurringOccurrence(tx, updatedTransaction);
    }

    if (scope === "future" && transaction.recurringGroupId) {
      const futureValues = { ...values };
      delete futureValues.status;
      await tx
        .update(transactions)
        .set({ ...futureValues, updatedAt: new Date() })
        .where(
          and(
            eq(transactions.recurringGroupId, transaction.recurringGroupId),
            eq(transactions.status, "recurring"),
            gt(transactions.date, transaction.date)
          )
        );
    }
  });

export const voidRecurringTransactionWithLifecycle = async (transaction: RegisterTransaction) =>
  updateRecurringTransactionWithLifecycle(transaction, { status: "void" }, "this");

export const isHistoricalRecurringTransaction = (transaction: RegisterTransaction) => historicalStatuses.has(transaction.status);
