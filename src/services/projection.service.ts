import { and, asc, eq, gte, inArray, lte, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, transactions } from "../db/schema.js";
import {
  addDays,
  balanceAffectingRegisterStatuses,
  isBalanceAffectingRegisterStatus,
  todayIso
} from "./accountRegister.service.js";
import { getAccountWorkingBalance } from "./balance.service.js";

export const PROJECTION_WINDOW_DAYS = 90;

type ProjectionStatus = (typeof balanceAffectingRegisterStatuses)[number];

export type ProjectionFilters = {
  accountId?: string;
  startDate?: string;
  endDate?: string;
  today?: string;
};

export type ProjectionAccountOption = {
  id: string;
  name: string;
};

export type ProjectionRow = {
  id: string;
  accountId: string;
  accountName: string;
  date: string;
  description: string;
  status: ProjectionStatus;
  amount: number;
  projectedBalance: number;
};

export type ProjectionResult = {
  accountOptions: ProjectionAccountOption[];
  filters: {
    accountId: string;
    startDate: string;
    endDate: string;
  };
  rows: ProjectionRow[];
};

const toNumber = (value: string | number | null | undefined) => Number(value ?? 0);

const previousDate = (date: string) => addDays(date, -1);
const projectionStatuses = [...balanceAffectingRegisterStatuses];

export const getRegisterProjections = async (filters: ProjectionFilters = {}): Promise<ProjectionResult> => {
  const today = filters.today ?? todayIso();
  const startDate = filters.startDate || addDays(today, 1);
  const endDate = filters.endDate || addDays(startDate, PROJECTION_WINDOW_DAYS);
  const baseThroughDate = startDate > today ? previousDate(startDate) : today;
  const requestedAccountId = filters.accountId || "";

  const activeAccounts = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.active, true))
    .orderBy(asc(accounts.displayOrder), asc(accounts.name));

  const selectedAccountIds = requestedAccountId
    ? activeAccounts.filter((account) => account.id === requestedAccountId).map((account) => account.id)
    : activeAccounts.map((account) => account.id);

  if (!selectedAccountIds.length || startDate > endDate) {
    return {
      accountOptions: activeAccounts,
      filters: { accountId: requestedAccountId, startDate, endDate },
      rows: []
    };
  }

  const balances = await Promise.all(
    selectedAccountIds.map(async (accountId) => ({
      accountId,
      balance: await getAccountWorkingBalance(accountId, { throughDate: baseThroughDate })
    }))
  );
  const runningBalances = new Map(balances.map((item) => [item.accountId, item.balance?.workingBalance ?? 0]));

  const queryFilters: SQL[] = [
    inArray(transactions.accountId, selectedAccountIds),
    inArray(transactions.status, projectionStatuses),
    gte(transactions.date, startDate),
    lte(transactions.date, endDate)
  ];

  const rows = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      accountName: accounts.name,
      date: transactions.date,
      description: transactions.description,
      status: transactions.status,
      amount: transactions.amount
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(and(...queryFilters))
    .orderBy(asc(accounts.displayOrder), asc(accounts.name), asc(transactions.date), asc(transactions.id));

  const projectionRows = rows
    .filter((row): row is typeof row & { accountId: string; status: ProjectionStatus } =>
      Boolean(row.accountId && row.date > baseThroughDate && isBalanceAffectingRegisterStatus(row.status as ProjectionStatus))
    )
    .map((row) => {
      const amount = toNumber(row.amount);
      const previousBalance = runningBalances.get(row.accountId) ?? 0;
      const projectedBalance = previousBalance + amount;
      runningBalances.set(row.accountId, projectedBalance);

      return {
        id: row.id,
        accountId: row.accountId,
        accountName: row.accountName,
        date: row.date,
        description: row.description,
        status: row.status,
        amount,
        projectedBalance
      };
    });

  return {
    accountOptions: activeAccounts,
    filters: { accountId: requestedAccountId, startDate, endDate },
    rows: projectionRows
  };
};
