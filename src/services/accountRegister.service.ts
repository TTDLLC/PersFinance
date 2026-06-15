import { Accounts } from "./accounts.service.js";
import type { RegisterView } from "./account.service.js";
import { and, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { transactions } from "../db/schema.js";

export const registerStatuses = ["entered", "pending", "cleared", "void"] as const;
export const editableRegisterStatuses = ["entered", "pending", "cleared"] as const;
export const voidableRegisterStatuses = ["entered", "pending", "cleared"] as const;

const toNumber = (value: string | number | null | undefined) => Number(value ?? 0);

export const getAccountRegister = async (accountId: string, view: RegisterView = "active") => {
  const account = await Accounts.getAccount(accountId);
  if (!account) return null;

  const rows =
    view === "void"
      ? await account.getVoidTransactions()
      : view === "all"
        ? await account.getAllTransactions()
        : await account.getActiveTransactions();
  const transferIds = [...new Set(rows.map((row) => row.transferId).filter((id): id is string => Boolean(id)))];
  const reconciledTransferRows = transferIds.length
    ? await db
        .select({ transferId: transactions.transferId })
        .from(transactions)
        .where(andTransferLocked(transferIds))
    : [];
  const lockedTransferIds = new Set(reconciledTransferRows.map((row) => row.transferId));

  let runningBalance = toNumber(account.getStatementBalance());
  const registerRows = rows.map((row) => {
    const amount = toNumber(row.amount);
    if (!row.statementId && row.status !== "void") runningBalance += amount;
    return {
      ...row,
      amount,
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
    view,
    statementBalance: toNumber(account.getStatementBalance()),
    displayLastReconciledDate: account.getDisplayStatementDate(),
    rows: registerRows
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
