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

const toMoney = (value: number) => value.toFixed(2);

const loadAccounts = async (accountIds: string[]) => {
  const rows = await db.select({ id: accounts.id, name: accounts.name, active: accounts.active }).from(accounts);
  return rows.filter((row) => accountIds.includes(row.id));
};

const validateAccounts = async (input: TransferInput) => {
  if (input.sourceAccountId === input.destinationAccountId) {
    throw new Error("Source and destination accounts must be different.");
  }
  const rows = await loadAccounts([input.sourceAccountId, input.destinationAccountId]);
  if (rows.length !== 2 || rows.some((row) => !row.active)) {
    throw new Error("Transfers require two active accounts.");
  }
  return new Map(rows.map((row) => [row.id, row]));
};

export const createTransfer = async (input: TransferInput) => {
  const accountMap = await validateAccounts(input);
  const source = accountMap.get(input.sourceAccountId);
  const destination = accountMap.get(input.destinationAccountId);
  if (!source || !destination) throw new Error("Transfer accounts were not found.");

  return db.transaction(async (tx) => {
    const transferId = randomUUID();

    await tx.insert(transactions).values([
      {
        transferId,
        accountId: source.id,
        date: input.date,
        amount: toMoney(-Math.abs(input.amount)),
        status: input.status,
        description: `Transfer to ${destination.name}`,
        notes: input.notes ?? null
      },
      {
        transferId,
        accountId: destination.id,
        date: input.date,
        amount: toMoney(Math.abs(input.amount)),
        status: input.status,
        description: `Transfer from ${source.name}`,
        notes: input.notes ?? null
      }
    ]);
    return transferId;
  });
};

export const getTransfer = async (transferId: string) => {
  const rows = await db.select().from(transactions).where(eq(transactions.transferId, transferId));
  if (rows.length !== 2) return null;
  const source = rows.find((row) => Number(row.amount) < 0);
  const destination = rows.find((row) => Number(row.amount) > 0);
  if (!source || !destination) return null;
  return {
    id: transferId,
    source,
    destination,
    locked: rows.some((row) => Boolean(row.statementId))
  };
};

export const updateTransfer = async (transferId: string, input: TransferInput) => {
  const accountMap = await validateAccounts(input);
  const sourceAccount = accountMap.get(input.sourceAccountId);
  const destinationAccount = accountMap.get(input.destinationAccountId);
  if (!sourceAccount || !destinationAccount) throw new Error("Transfer accounts were not found.");

  return db.transaction(async (tx) => {
    const rows = await tx.select().from(transactions).where(eq(transactions.transferId, transferId));
    if (rows.length !== 2) throw new Error("Transfer is incomplete and cannot be edited.");
    if (rows.some((row) => row.statementId)) throw new Error("Reconciled transfers are locked and cannot be edited.");

    const source = rows.find((row) => Number(row.amount) < 0);
    const destination = rows.find((row) => Number(row.amount) > 0);
    if (!source || !destination) throw new Error("Transfer sides are invalid.");

    await tx
      .update(transactions)
      .set({
        accountId: sourceAccount.id,
        date: input.date,
        amount: toMoney(-Math.abs(input.amount)),
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
        amount: toMoney(Math.abs(input.amount)),
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
