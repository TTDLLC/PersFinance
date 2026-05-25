import { and, asc, eq, gte, inArray, isNull, lte, ne, or, type AnyColumn, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  accounts,
  futureTransactions,
  recurringTransactions
} from "../db/schema.js";

export type ProjectionSourceType =
  | "recurring_bill"
  | "recurring_income"
  | "future_transaction";

export type ProjectionRow = {
  date: string;
  accountId: string;
  accountName: string;
  description: string;
  transactionType: string;
  status: string;
  amount: number;
  projectedBalance: number;
  sourceType: ProjectionSourceType;
  sourceId: string;
};

export type MonthlyProjectionSummary = {
  month: string;
  startingBalance: number;
  incomeTotal: number;
  expenseTotal: number;
  netChange: number;
  endingBalance: number;
  lowestBalance: number;
};

export type DashboardProjectionMetrics = {
  startingCash: number;
  projected30DayBalance: number;
  projected90DayBalance: number;
  lowestBalance: number;
};

export type ProjectionOptions = {
  startDate?: string;
  endDate?: string;
  monthsAhead?: number;
  scenarioIds?: string[];
  accountId?: string;
  includeEstimates?: boolean;
  includePending?: boolean;
};

type GeneratedRecurringInstance = Omit<ProjectionRow, "projectedBalance">;

const toNumber = (value: string | number | null | undefined) => Number(value ?? 0);
const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

const addMonths = (date: Date, months: number) => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
};

const getDateRange = (options: ProjectionOptions) => {
  const start = options.startDate ? new Date(`${options.startDate}T00:00:00`) : new Date();
  const end = options.endDate
    ? new Date(`${options.endDate}T00:00:00`)
    : addMonths(start, options.monthsAhead ?? 18);

  return { start, end, startDate: toIsoDate(start), endDate: toIsoDate(end) };
};

export const getStartingCash = async () => {
  const projectionAccounts = await db
    .select({ currentBalance: accounts.currentBalance })
    .from(accounts)
    .where(and(eq(accounts.active, true), eq(accounts.includeInProjection, true)));

  return projectionAccounts.reduce((sum, account) => sum + toNumber(account.currentBalance), 0);
};

const daysBetween = (from: Date, to: Date) =>
  Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));

export const getLastDayOfMonth = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();

// Monthly rules fall back to the target month's last day when the requested date does not exist.
export const getScheduledDayForMonth = (date: Date, requestedDay: number | null) => {
  if (!requestedDay) return null;
  return Math.min(requestedDay, getLastDayOfMonth(date));
};

const isRecurringOccurrence = (
  scheduleType: string,
  cursor: Date,
  anchor: Date,
  dayOfMonth: number | null,
  secondDayOfMonth: number | null
) => {
  const elapsedDays = daysBetween(anchor, cursor);
  const day = cursor.getDate();

  if (scheduleType === "weekly") return elapsedDays >= 0 && elapsedDays % 7 === 0;
  if (scheduleType === "biweekly") return elapsedDays >= 0 && elapsedDays % 14 === 0;
  if (scheduleType === "monthly") return day === getScheduledDayForMonth(cursor, dayOfMonth);
  if (scheduleType === "semimonthly") {
    return (
      day === getScheduledDayForMonth(cursor, dayOfMonth) ||
      day === getScheduledDayForMonth(cursor, secondDayOfMonth)
    );
  }

  return false;
};

const applyStatusFilters = (
  filters: SQL[],
  options: ProjectionOptions,
  statusColumn: AnyColumn,
  estimateColumn?: AnyColumn
) => {
  filters.push(ne(statusColumn, "archived"));
  if (options.includePending === false) filters.push(ne(statusColumn, "pending"));
  if (options.includeEstimates === false) {
    filters.push(ne(statusColumn, "estimate"));
    if (estimateColumn) filters.push(ne(estimateColumn, "estimate"));
  }
};

export const generateRecurringTransactionInstances = async (
  options: ProjectionOptions = {}
): Promise<GeneratedRecurringInstance[]> => {
  const { start, end, endDate } = getDateRange(options);
  const filters: SQL[] = [
    eq(recurringTransactions.active, true),
    eq(accounts.active, true),
    eq(accounts.includeInProjection, true),
    lte(recurringTransactions.startDate, endDate),
    or(isNull(recurringTransactions.endDate), gte(recurringTransactions.endDate, toIsoDate(start)))!
  ];

  applyStatusFilters(filters, options, recurringTransactions.status, recurringTransactions.amountType);
  if (options.accountId) filters.push(eq(recurringTransactions.accountId, options.accountId));

  const rows = await db
    .select({
      id: recurringTransactions.id,
      name: recurringTransactions.name,
      kind: recurringTransactions.kind,
      amount: recurringTransactions.amount,
      scheduleType: recurringTransactions.scheduleType,
      dayOfMonth: recurringTransactions.dayOfMonth,
      secondDayOfMonth: recurringTransactions.secondDayOfMonth,
      startDate: recurringTransactions.startDate,
      endDate: recurringTransactions.endDate,
      status: recurringTransactions.status,
      accountId: accounts.id,
      accountName: accounts.name
    })
    .from(recurringTransactions)
    .leftJoin(accounts, eq(recurringTransactions.accountId, accounts.id))
    .where(and(...filters));

  const instances: GeneratedRecurringInstance[] = [];

  for (const row of rows) {
    if (!row.accountId || !row.accountName) continue;

    const anchor = new Date(`${row.startDate}T00:00:00`);
    const cursor = new Date(Math.max(start.getTime(), anchor.getTime()));
    const amount = toNumber(row.amount);
    const finalDate = row.endDate
      ? new Date(Math.min(end.getTime(), new Date(`${row.endDate}T00:00:00`).getTime()))
      : end;

    while (cursor <= finalDate) {
      if (
        isRecurringOccurrence(
          row.scheduleType,
          cursor,
          anchor,
          row.dayOfMonth,
          row.secondDayOfMonth
        )
      ) {
        instances.push({
          date: toIsoDate(cursor),
          accountId: row.accountId,
          accountName: row.accountName,
          description: row.name,
          transactionType: row.kind,
          status: row.status,
          amount,
          sourceType: row.kind === "income" ? "recurring_income" : "recurring_bill",
          sourceId: row.id
        });
      }

      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return instances;
};

export const buildProjectionRows = async (
  options: ProjectionOptions = {}
): Promise<ProjectionRow[]> => {
  const { startDate, endDate } = getDateRange(options);
  const futureFilters: SQL[] = [
    eq(futureTransactions.includeInProjection, true),
    eq(accounts.active, true),
    eq(accounts.includeInProjection, true),
    ne(futureTransactions.status, "cancelled"),
    ne(futureTransactions.status, "cleared"),
    gte(futureTransactions.date, startDate),
    lte(futureTransactions.date, endDate)
  ];

  const selectedScenarioIds = options.scenarioIds ?? [];
  futureFilters.push(
    selectedScenarioIds.length
      ? or(isNull(futureTransactions.scenarioId), inArray(futureTransactions.scenarioId, selectedScenarioIds))!
      : isNull(futureTransactions.scenarioId)
  );
  if (options.accountId) futureFilters.push(eq(futureTransactions.accountId, options.accountId));
  if (options.includePending === false) futureFilters.push(ne(futureTransactions.status, "pending"));
  if (options.includeEstimates === false) futureFilters.push(ne(futureTransactions.status, "estimate"));

  const projectionAccounts = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.active, true), eq(accounts.includeInProjection, true)))
    .orderBy(asc(accounts.displayOrder), asc(accounts.name));

  const futureRows = await db
    .select({
      id: futureTransactions.id,
      date: futureTransactions.date,
      description: futureTransactions.description,
      amount: futureTransactions.amount,
      transactionType: futureTransactions.transactionType,
      status: futureTransactions.status,
      accountId: accounts.id,
      accountName: accounts.name
    })
    .from(futureTransactions)
    .leftJoin(accounts, eq(futureTransactions.accountId, accounts.id))
    .where(and(...futureFilters));

  const generatedRecurring = await generateRecurringTransactionInstances(options);
  const balances = new Map(
    projectionAccounts.map((account) => [account.id, toNumber(account.currentBalance)])
  );

  const rows: ProjectionRow[] = [
    ...generatedRecurring,
    ...futureRows
      .filter((row) => row.accountId && row.accountName)
      .map((row) => ({
        date: row.date,
        accountId: row.accountId!,
        accountName: row.accountName!,
        description: row.description,
        transactionType: row.transactionType,
        status: row.status,
        amount: toNumber(row.amount),
        sourceType: "future_transaction" as const,
        sourceId: row.id
      }))
  ]
    .sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description))
    .map((row) => {
      const nextBalance = toNumber(balances.get(row.accountId)) + row.amount;
      balances.set(row.accountId, nextBalance);
      return { ...row, projectedBalance: nextBalance };
    });

  return rows;
};

export const buildMonthlySummary = async (
  options: ProjectionOptions = {}
): Promise<MonthlyProjectionSummary[]> => {
  const projectionRows = await buildProjectionRows(options);
  const startingBalance = await db
    .select({ currentBalance: accounts.currentBalance })
    .from(accounts)
    .where(and(eq(accounts.active, true), eq(accounts.includeInProjection, true)));

  let runningBalance = startingBalance.reduce((sum, account) => sum + toNumber(account.currentBalance), 0);
  const summaries = new Map<string, MonthlyProjectionSummary>();

  for (const row of projectionRows) {
    const month = row.date.slice(0, 7);
    if (!summaries.has(month)) {
      summaries.set(month, {
        month,
        startingBalance: runningBalance,
        incomeTotal: 0,
        expenseTotal: 0,
        netChange: 0,
        endingBalance: runningBalance,
        lowestBalance: runningBalance
      });
    }

    const summary = summaries.get(month)!;
    if (row.amount >= 0) summary.incomeTotal += row.amount;
    else summary.expenseTotal += row.amount;

    runningBalance += row.amount;
    summary.netChange += row.amount;
    summary.endingBalance = runningBalance;
    summary.lowestBalance = Math.min(summary.lowestBalance, runningBalance);
  }

  return Array.from(summaries.values());
};

export const buildDashboardProjectionMetrics = async (
  options: ProjectionOptions = {}
): Promise<DashboardProjectionMetrics> => {
  const today = options.startDate ?? toIsoDate(new Date());
  const start = new Date(`${today}T00:00:00`);
  const ninetyDays = new Date(start);
  ninetyDays.setDate(ninetyDays.getDate() + 90);

  const startingCash = await getStartingCash();
  const rows = await buildProjectionRows({
    ...options,
    startDate: today,
    endDate: toIsoDate(ninetyDays)
  });

  let runningBalance = startingCash;
  let projected30DayBalance = startingCash;
  let projected90DayBalance = startingCash;
  let lowestBalance = startingCash;
  const thirtyDayCutoff = new Date(start);
  thirtyDayCutoff.setDate(thirtyDayCutoff.getDate() + 30);

  for (const row of rows) {
    runningBalance += row.amount;
    const rowDate = new Date(`${row.date}T00:00:00`);
    if (rowDate <= thirtyDayCutoff) projected30DayBalance = runningBalance;
    projected90DayBalance = runningBalance;
    lowestBalance = Math.min(lowestBalance, runningBalance);
  }

  return {
    startingCash,
    projected30DayBalance,
    projected90DayBalance,
    lowestBalance
  };
};
