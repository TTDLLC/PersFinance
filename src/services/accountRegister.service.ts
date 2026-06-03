import { and, asc, desc, eq, gt, lte, ne, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import { accountBalanceSnapshots, accounts, categories, transactions } from "../db/schema.js";

export const REGISTER_FUTURE_WINDOW_DAYS = 60; // TODO: make configurable when register settings exist.

export const registerStatuses = ["entered", "pending", "cleared", "statement", "recurring", "void"] as const;
export const balanceAffectingRegisterStatuses = ["entered", "pending", "cleared", "recurring"] as const;
export const editableRegisterStatuses = ["entered", "pending", "cleared", "recurring"] as const;
export const voidableRegisterStatuses = ["entered", "pending", "cleared", "recurring"] as const;

type RegisterStatus = (typeof registerStatuses)[number];

export type AccountRegisterOptions = {
  showFuture?: boolean;
  showVoid?: boolean;
  today?: string;
  futureWindowDays?: number;
};

export type AccountRegisterRow = {
  id: string;
  date: string;
  description: string;
  categoryName: string | null;
  amount: number;
  status: RegisterStatus;
  amountType: "fixed" | "estimate";
  balanceAfter: number;
  isFuture: boolean;
  canEdit: boolean;
  canVoid: boolean;
};

export type AccountRegister = {
  account: typeof accounts.$inferSelect;
  latestSnapshotDate: string | null;
  latestSnapshotBalance: number;
  futureWindowDays: number;
  futureThroughDate: string;
  showFuture: boolean;
  showVoid: boolean;
  rows: AccountRegisterRow[];
};

const toNumber = (value: string | number | null | undefined) => Number(value ?? 0);
const balanceAffectingStatusSet = new Set<RegisterStatus>(balanceAffectingRegisterStatuses);
export const isBalanceAffectingRegisterStatus = (status: RegisterStatus) => balanceAffectingStatusSet.has(status);

export const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

export const addDays = (date: string, days: number) => {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return toIsoDate(next);
};

export const todayIso = () => toIsoDate(new Date());

export const getAccountRegister = async (
  accountId: string,
  options: AccountRegisterOptions = {}
): Promise<AccountRegister | null> => {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!account) return null;

  const showFuture = options.showFuture ?? true;
  const showVoid = options.showVoid ?? false;
  const today = options.today ?? todayIso();
  const futureWindowDays = options.futureWindowDays ?? REGISTER_FUTURE_WINDOW_DAYS;
  const futureThroughDate = addDays(today, futureWindowDays);

  const [snapshot] = await db
    .select()
    .from(accountBalanceSnapshots)
    .where(eq(accountBalanceSnapshots.accountId, accountId))
    .orderBy(desc(accountBalanceSnapshots.snapshotDate), desc(accountBalanceSnapshots.createdAt))
    .limit(1);

  const filters: SQL[] = [
    eq(transactions.accountId, accountId),
    ne(transactions.status, "statement"),
    lte(transactions.date, showFuture ? futureThroughDate : today)
  ];

  if (snapshot) filters.push(gt(transactions.date, snapshot.snapshotDate));
  if (!showVoid) filters.push(ne(transactions.status, "void"));

  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      description: transactions.description,
      amount: transactions.amount,
      status: transactions.status,
      amountType: transactions.amountType,
      categoryName: categories.name
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(...filters))
    .orderBy(asc(transactions.date), asc(transactions.id));

  let runningBalance = toNumber(snapshot?.balance);
  const registerRows = rows.map((row) => {
    const amount = toNumber(row.amount);
    const status = row.status as RegisterStatus;
    if (isBalanceAffectingRegisterStatus(status)) {
      runningBalance += amount;
    }

    return {
      id: row.id,
      date: row.date,
      description: row.description,
      categoryName: row.categoryName,
      amount,
      status,
      amountType: row.amountType,
      balanceAfter: runningBalance,
      isFuture: row.date > today,
      canEdit: editableRegisterStatuses.includes(row.status as (typeof editableRegisterStatuses)[number]),
      canVoid: voidableRegisterStatuses.includes(row.status as (typeof voidableRegisterStatuses)[number])
    };
  });

  return {
    account,
    latestSnapshotDate: snapshot?.snapshotDate ?? null,
    latestSnapshotBalance: toNumber(snapshot?.balance),
    futureWindowDays,
    futureThroughDate,
    showFuture,
    showVoid,
    rows: registerRows
  };
};

export const findRegisterTransaction = async (accountId: string, transactionId: string) => {
  const [transaction] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.accountId, accountId)))
    .limit(1);
  return transaction ?? null;
};
