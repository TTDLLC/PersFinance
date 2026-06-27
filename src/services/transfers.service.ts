import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { accounts, transactions } from "../db/schema.js";

type TransferStatus = "entered" | "pending" | "cleared";

export type TransferInput = {
  date: string;
  amount: number;
  sourceAccountId: string;
  destinationAccountId: string;
  status: TransferStatus;
  notes?: string | null;
};

const liabilityAccountTypes = new Set<typeof accounts.$inferSelect.type>(["credit_card", "loan"]);
const toMoney = (value: number) => value.toFixed(2);
const transferAmountForAccount = (role: "source" | "destination", account: Pick<typeof accounts.$inferSelect, "type">, amount: number) => {
  if (role === "source") return amount;
  return liabilityAccountTypes.has(account.type) ? -Math.abs(amount) : Math.abs(amount);
};

const loadAccounts = async (executor: Pick<typeof db, "select">, accountIds: string[]) => {
  const rows = await executor.select({ id: accounts.id, name: accounts.name, type: accounts.type, active: accounts.active }).from(accounts);
  return rows.filter((row) => accountIds.includes(row.id));
};

const validateAccounts = async (executor: Pick<typeof db, "select">, input: TransferInput) => {
  if (input.sourceAccountId === input.destinationAccountId) {
    throw new Error("Source and destination accounts must be different.");
  }
  const rows = await loadAccounts(executor, [input.sourceAccountId, input.destinationAccountId]);
  if (rows.length !== 2 || rows.some((row) => !row.active)) {
    throw new Error("Transfers require two active accounts.");
  }
  return new Map(rows.map((row) => [row.id, row]));
};

export const createTransferRows = async (executor: Pick<typeof db, "select" | "insert">, input: TransferInput) => {
  const accountMap = await validateAccounts(executor, input);
  const source = accountMap.get(input.sourceAccountId);
  const destination = accountMap.get(input.destinationAccountId);
  if (!source || !destination) throw new Error("Transfer accounts were not found.");

  const transferId = randomUUID();

  await executor.insert(transactions).values([
    {
      transferId,
      accountId: source.id,
      date: input.date,
      amount: toMoney(transferAmountForAccount("source", source, input.amount)),
      status: input.status,
      description: `Transfer to ${destination.name}`,
      notes: input.notes ?? null
    },
    {
      transferId,
      accountId: destination.id,
      date: input.date,
      amount: toMoney(transferAmountForAccount("destination", destination, input.amount)),
      status: input.status,
      description: `Transfer from ${source.name}`,
      notes: input.notes ?? null
    }
  ]);
  return transferId;
};

export const createTransfer = async (input: TransferInput) => db.transaction((tx) => createTransferRows(tx, input));

export const getTransfer = async (transferId: string) => {
  const rows = await db.select().from(transactions).where(eq(transactions.transferId, transferId));
  if (rows.length !== 2) return null;
  const source = rows.find((row) => row.description?.startsWith("Transfer to ")) ?? rows.find((row) => Number(row.amount) < 0);
  const destination = rows.find((row) => row.description?.startsWith("Transfer from ")) ?? rows.find((row) => Number(row.amount) > 0);
  if (!source || !destination) return null;
  return {
    id: transferId,
    source,
    destination,
    locked: rows.some((row) => Boolean(row.statementId))
  };
};

export const updateTransfer = async (transferId: string, input: TransferInput) => {
  const accountMap = await validateAccounts(db, input);
  const sourceAccount = accountMap.get(input.sourceAccountId);
  const destinationAccount = accountMap.get(input.destinationAccountId);
  if (!sourceAccount || !destinationAccount) throw new Error("Transfer accounts were not found.");

  return db.transaction(async (tx) => {
    const rows = await tx.select().from(transactions).where(eq(transactions.transferId, transferId));
    if (rows.length !== 2) throw new Error("Transfer is incomplete and cannot be edited.");
    if (rows.some((row) => row.statementId)) throw new Error("Reconciled transfers are locked and cannot be edited.");

    const source = rows.find((row) => row.description?.startsWith("Transfer to ")) ?? rows.find((row) => Number(row.amount) < 0);
    const destination = rows.find((row) => row.description?.startsWith("Transfer from ")) ?? rows.find((row) => Number(row.amount) > 0);
    if (!source || !destination) throw new Error("Transfer sides are invalid.");

    await tx
      .update(transactions)
      .set({
        accountId: sourceAccount.id,
        date: input.date,
        amount: toMoney(transferAmountForAccount("source", sourceAccount, input.amount)),
        status: input.status,
        description: `Transfer to ${destinationAccount.name}`,
        notes: input.notes ?? null,
        updatedAt: new Date()
      })
      .where(and(eq(transactions.id, source.id), eq(transactions.transferId, transferId)));

    await tx
      .update(transactions)
      .set({
        accountId: destinationAccount.id,
        date: input.date,
        amount: toMoney(transferAmountForAccount("destination", destinationAccount, input.amount)),
        status: input.status,
        description: `Transfer from ${sourceAccount.name}`,
        notes: input.notes ?? null,
        updatedAt: new Date()
      })
      .where(and(eq(transactions.id, destination.id), eq(transactions.transferId, transferId)));
  });
};

export const deleteTransfer = async (transferId: string) =>
  db.transaction(async (tx) => {
    const rows = await tx.select().from(transactions).where(eq(transactions.transferId, transferId));
    if (rows.length !== 2) throw new Error("Transfer is incomplete and cannot be deleted.");
    if (rows.some((row) => row.statementId)) throw new Error("Reconciled transfers are locked and cannot be deleted.");
    await tx.delete(transactions).where(eq(transactions.transferId, transferId));
  });
