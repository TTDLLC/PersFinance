import { Accounts } from "./accounts.service.js";
import type { RegisterView } from "./account.service.js";

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

  let runningBalance = toNumber(account.getStatementBalance());
  const registerRows = rows.map((row) => {
    const amount = toNumber(row.amount);
    if (!row.statementId && row.status !== "void") runningBalance += amount;
    return {
      ...row,
      amount,
      balanceAfter: runningBalance,
      canEdit: !row.statementId && editableRegisterStatuses.includes(row.status as (typeof editableRegisterStatuses)[number]),
      canVoid: !row.statementId && voidableRegisterStatuses.includes(row.status as (typeof voidableRegisterStatuses)[number])
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

export const findRegisterTransaction = async (accountId: string, transactionId: string) => {
  const account = await Accounts.getAccount(accountId);
  if (!account) return null;
  const allRows = await account.getAllTransactions();
  const voidRows = await account.getVoidTransactions();
  return [...allRows, ...voidRows].find((row) => row.id === transactionId) ?? null;
};
