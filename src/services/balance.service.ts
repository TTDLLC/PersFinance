import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { accountBalanceSnapshots, accounts, transactions } from "../db/schema.js";

const balanceAffectingStatuses: Array<"entered" | "pending" | "cleared" | "recurring"> = [
  "entered",
  "pending",
  "cleared",
  "recurring"
];
const toNumber = (value: string | number | null | undefined) => Number(value ?? 0);

export type AccountWorkingBalance = {
  accountId: string;
  accountName: string;
  latestSnapshotDate: string | null;
  latestSnapshotBalance: number;
  postSnapshotActivityTotal: number;
  workingBalance: number;
};

export const getAccountWorkingBalance = async (accountId: string): Promise<AccountWorkingBalance | null> => {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!account) return null;

  const [snapshot] = await db
    .select()
    .from(accountBalanceSnapshots)
    .where(eq(accountBalanceSnapshots.accountId, accountId))
    .orderBy(desc(accountBalanceSnapshots.snapshotDate), desc(accountBalanceSnapshots.createdAt))
    .limit(1);

  const activityFilters = [
    eq(transactions.accountId, accountId),
    inArray(transactions.status, balanceAffectingStatuses)
  ];
  if (snapshot) activityFilters.push(gt(transactions.date, snapshot.snapshotDate));

  const activity = await db
    .select({ amount: transactions.amount })
    .from(transactions)
    .where(and(...activityFilters))
    .orderBy(asc(transactions.date), asc(transactions.createdAt));

  const latestSnapshotBalance = toNumber(snapshot?.balance);
  const postSnapshotActivityTotal = activity.reduce((sum, row) => sum + toNumber(row.amount), 0);

  return {
    accountId,
    accountName: account.name,
    latestSnapshotDate: snapshot?.snapshotDate ?? null,
    latestSnapshotBalance,
    postSnapshotActivityTotal,
    workingBalance: latestSnapshotBalance + postSnapshotActivityTotal
  };
};

export const getAllAccountWorkingBalances = async (): Promise<AccountWorkingBalance[]> => {
  const activeAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.active, true))
    .orderBy(asc(accounts.displayOrder), asc(accounts.name));

  const balances = await Promise.all(activeAccounts.map((account) => getAccountWorkingBalance(account.id)));
  return balances.filter((balance): balance is AccountWorkingBalance => Boolean(balance));
};
