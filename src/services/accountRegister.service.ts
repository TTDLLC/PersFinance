import { Accounts } from "./accounts.service.js";
import type { RegisterStatus } from "./account.service.js";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { transactions } from "../db/schema.js";

export const registerStatuses = ["entered", "pending", "cleared", "void"] as const;
export const editableRegisterStatuses = ["entered", "pending", "cleared"] as const;
export const voidableRegisterStatuses = ["entered", "pending", "cleared"] as const;
export const defaultRegisterStatuses: RegisterStatus[] = ["entered", "pending", "cleared"];

const toNumber = (value: string | number | null | undefined) => Number(value ?? 0);

export const getAccountRegister = async (accountId: string, selectedStatuses: RegisterStatus[] = defaultRegisterStatuses) => {
  const account = await Accounts.getAccount(accountId);
  if (!account) return null;

  const statuses = normalizeRegisterStatuses(selectedStatuses);
  const allStatusesSelected = statuses.length === registerStatuses.length;
  const rows = allStatusesSelected ? await account.getAllTransactions() : await account.getTransactionsByStatuses(statuses);
  const transferIds = [...new Set(rows.map((row) => row.transferId).filter((id): id is string => Boolean(id)))];
  const reconciledTransferRows = transferIds.length
    ? await db
        .select({ transferId: transactions.transferId })
        .from(transactions)
        .where(andTransferLocked(transferIds))
    : [];
  const lockedTransferIds = new Set(reconciledTransferRows.map((row) => row.transferId));

  const summary = await getRegisterBalanceSummary(account.id, toNumber(account.getStatementBalance()));
  let runningBalance = statuses.includes("cleared") || allStatusesSelected ? toNumber(account.getStatementBalance()) : summary.currentBalance;
  const registerRows = rows.map((row) => {
    const amount = toNumber(row.amount);
    if (!row.statementId && row.status === "cleared") runningBalance += amount;
    return {
      ...row,
      amount,
      balance: row.status === "cleared" ? runningBalance : null,
      balanceAfter: runningBalance,
      transferLocked: Boolean(row.transferId && lockedTransferIds.has(row.transferId)),
      canEdit:
        !row.statementId &&
        !(row.transferId && lockedTransferIds.has(row.transferId)) &&
        editableRegisterStatuses.includes(row.status as (typeof editableRegisterStatuses)[number]),
      canVoid:
        !row.transferId &&
        !row.statementId &&
        voidableRegisterStatuses.includes(row.status as (typeof voidableRegisterStatuses)[number])
    };
  });

  return {
    account: account.data,
    balance: await account.getBalance({ extended: true }),
    balanceSummary: summary,
    selectedStatuses: statuses,
    allStatusesSelected,
    view: allStatusesSelected ? "all" : statuses.join(","),
    statementBalance: toNumber(account.getStatementBalance()),
    displayLastReconciledDate: account.getDisplayStatementDate(),
    rows: registerRows
  };
};

export const normalizeRegisterStatuses = (statuses: readonly unknown[] | unknown): RegisterStatus[] => {
  const rawStatuses = Array.isArray(statuses) ? statuses : [statuses];
  const selected = rawStatuses.filter((status): status is RegisterStatus =>
    registerStatuses.includes(status as (typeof registerStatuses)[number])
  );
  const unique = [...new Set(selected)];
  return unique.length ? unique : [...defaultRegisterStatuses];
};

const getStatusTotal = async (accountId: string, status: (typeof registerStatuses)[number]) => {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), isNull(transactions.statementId), eq(transactions.status, status)));
  return toNumber(row?.total);
};

const getRegisterBalanceSummary = async (accountId: string, statementBalance: number) => {
  const clearedTotal = await getStatusTotal(accountId, "cleared");
  const enteredBalance = -(await getStatusTotal(accountId, "entered"));
  const pendingBalance = -(await getStatusTotal(accountId, "pending"));
  const currentBalance = statementBalance + clearedTotal;

  return {
    currentBalance,
    enteredBalance,
    pendingBalance,
    finalBalance: currentBalance - enteredBalance - pendingBalance
  };
};

const andTransferLocked = (transferIds: string[]) =>
  and(inArray(transactions.transferId, transferIds), isNotNull(transactions.statementId));

export const findRegisterTransaction = async (accountId: string, transactionId: string) => {
  const account = await Accounts.getAccount(accountId);
  if (!account) return null;
  const allRows = await account.getAllTransactions();
  const voidRows = await account.getVoidTransactions();
  return [...allRows, ...voidRows].find((row) => row.id === transactionId) ?? null;
};
