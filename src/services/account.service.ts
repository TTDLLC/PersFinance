import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, accountStatements, categories, payees, transactions } from "../db/schema.js";

type Db = typeof db;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Client = Db | Tx;
type AccountRow = typeof accounts.$inferSelect;
type TransactionStatus = typeof transactions.$inferSelect.status;

export type BalanceDetails = {
  currentBalance: string;
  statementBalance: string;
  activeTransactionTotal: string;
  asOf: string;
};

export type RegisterView = "active" | "all" | "void";

export type ReconciliationInput = {
  statementDate: string;
  endingBalance: number;
  selectedTransactionIds: string[];
  notes?: string | null;
};

export type ReconciliationPreview = {
  statementDate: string;
  previousStatementId: string;
  startingBalance: string;
  endingBalance: string;
  selectedTransactionTotal: string;
  calculatedReconciledBalance: string;
  difference: string;
  selectedTransactionIds: Set<string>;
  eligibleTransactions: Awaited<ReturnType<Account["getActiveTransactions"]>>;
};

const toNumber = (value: string | number | null | undefined) => Number(value ?? 0);
const toMoney = (value: string | number) => toNumber(value).toFixed(2);
const toCents = (value: string | number | null | undefined) => Math.round(toNumber(value) * 100);
const today = () => new Date().toISOString().slice(0, 10);

const displayBalance = (account: AccountRow, value: string | number) => {
  const numeric = toNumber(value);
  return ["credit_card", "loan"].includes(account.type) ? Math.abs(numeric).toFixed(2) : numeric.toFixed(2);
};

const previousStatementIdFor = async (client: Client, account: AccountRow) => {
  if (account.lastReconciledStatementId) return account.lastReconciledStatementId;

  const [latestStatement] = await client
    .select({ id: accountStatements.id })
    .from(accountStatements)
    .where(and(eq(accountStatements.accountId, account.id), eq(accountStatements.reconciled, true)))
    .orderBy(desc(accountStatements.statementDate), desc(accountStatements.updatedAt))
    .limit(1);

  return latestStatement?.id ?? "initial";
};

export class Account {
  constructor(private readonly row: AccountRow) {}

  get id() {
    return this.row.id;
  }

  get data() {
    return this.row;
  }

  getDisplayStatementDate() {
    return this.row.lastReconciledStatementId ? this.row.lastReconciledDate : null;
  }

  getStartingInformation() {
    return {
      balance: this.row.startingInformationBalance,
      date: this.row.startingInformationDate,
      notes: this.row.startingInformationNotes
    };
  }

  getStatementBalance() {
    return this.row.statementChainBalance;
  }

  getLastReconciledDate() {
    return this.row.lastReconciledDate;
  }

  getLastReconciledStatementId() {
    return this.row.lastReconciledStatementId;
  }

  async getBalance(): Promise<string>;
  async getBalance(options: { extended: true }): Promise<BalanceDetails>;
  async getBalance(options?: { extended?: boolean }) {
    const [activeTotal] = await db
      .select({ total: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
      .from(transactions)
      .where(and(eq(transactions.accountId, this.id), isNull(transactions.statementId), ne(transactions.status, "void")));

    const statementBalance = toCents(this.row.statementChainBalance);
    const activeTransactionTotal = toCents(activeTotal?.total);
    const currentBalance = (statementBalance + activeTransactionTotal) / 100;

    if (options?.extended) {
      return {
        currentBalance: displayBalance(this.row, currentBalance),
        statementBalance: displayBalance(this.row, this.row.statementChainBalance),
        activeTransactionTotal: toMoney(activeTransactionTotal / 100),
        asOf: today()
      };
    }

    return displayBalance(this.row, currentBalance);
  }

  async getActiveTransactions() {
    return transactionRows(this.id, "active");
  }

  async getAllTransactions() {
    return transactionRows(this.id, "all");
  }

  async getVoidTransactions() {
    return transactionRows(this.id, "void");
  }

  async getStatement(statementId: string) {
    const [statement] = await db
      .select()
      .from(accountStatements)
      .where(and(eq(accountStatements.id, statementId), eq(accountStatements.accountId, this.id)))
      .limit(1);
    return statement ?? null;
  }

  async getStatements() {
    return db
      .select({
        id: accountStatements.id,
        statementDate: accountStatements.statementDate,
        previousStatementId: accountStatements.previousStatementId,
        startingBalance: accountStatements.startingBalance,
        endingBalance: accountStatements.endingBalance,
        reconciledBalance: accountStatements.reconciledBalance,
        reconciled: accountStatements.reconciled,
        notes: accountStatements.notes,
        createdAt: accountStatements.createdAt,
        updatedAt: accountStatements.updatedAt,
        transactionCount: sql<number>`count(${transactions.id})::int`
      })
      .from(accountStatements)
      .leftJoin(transactions, eq(transactions.statementId, accountStatements.id))
      .where(eq(accountStatements.accountId, this.id))
      .groupBy(accountStatements.id)
      .orderBy(desc(accountStatements.statementDate), desc(accountStatements.updatedAt));
  }

  async getStatementTransactions(statementId: string) {
    return transactionRows(this.id, "statement", statementId);
  }

  async canEditStartingInformation() {
    const [activity] = await db
      .select({
        transactionCount: sql<number>`count(${transactions.id})::int`,
        statementCount: sql<number>`count(${accountStatements.id})::int`
      })
      .from(accounts)
      .leftJoin(transactions, eq(transactions.accountId, accounts.id))
      .leftJoin(accountStatements, and(eq(accountStatements.accountId, accounts.id), eq(accountStatements.reconciled, true)))
      .where(eq(accounts.id, this.id))
      .groupBy(accounts.id);

    const statementCount = activity?.statementCount ?? 0;
    const transactionCount = activity?.transactionCount ?? 0;
    return {
      editable: statementCount === 0,
      warning: statementCount === 0 && transactionCount > 0,
      transactionCount,
      statementCount
    };
  }

  async previewReconciliation(input: ReconciliationInput): Promise<ReconciliationPreview> {
    const selectedTransactionIds = [...new Set(input.selectedTransactionIds)];
    const eligibleTransactions = await this.getActiveTransactions();
    const selectedSet = new Set(selectedTransactionIds);
    const selectedTransactionTotal = eligibleTransactions.reduce(
      (sum, transaction) => sum + (selectedSet.has(transaction.id) ? toCents(transaction.amount) : 0),
      0
    );
    const startingBalance = toCents(this.row.statementChainBalance);
    const endingBalance = toCents(input.endingBalance);
    const calculatedReconciledBalance = startingBalance + selectedTransactionTotal;

    return {
      statementDate: input.statementDate,
      previousStatementId: await previousStatementIdFor(db, this.row),
      startingBalance: toMoney(startingBalance / 100),
      endingBalance: toMoney(endingBalance / 100),
      selectedTransactionTotal: toMoney(selectedTransactionTotal / 100),
      calculatedReconciledBalance: toMoney(calculatedReconciledBalance / 100),
      difference: toMoney((endingBalance - calculatedReconciledBalance) / 100),
      selectedTransactionIds: selectedSet,
      eligibleTransactions
    };
  }

  async reconcileStatement(input: ReconciliationInput) {
    const selectedTransactionIds = [...new Set(input.selectedTransactionIds)];

    return db.transaction(async (tx) => {
      const lockedAccount = await loadAccount(tx, this.id);
      if (!lockedAccount) throw new Error("Account not found.");

      const selectedRows = selectedTransactionIds.length
        ? await tx
            .select({ id: transactions.id, amount: transactions.amount })
            .from(transactions)
            .where(
              and(
                eq(transactions.accountId, this.id),
                inArray(transactions.id, selectedTransactionIds),
                isNull(transactions.statementId),
                ne(transactions.status, "void")
              )
            )
        : [];

      if (selectedRows.length !== selectedTransactionIds.length) {
        throw new Error("Selected transactions must be active, non-void transactions for this account.");
      }

      const selectedTotal = selectedRows.reduce((sum, transaction) => sum + toCents(transaction.amount), 0);
      const startingBalance = toCents(lockedAccount.statementChainBalance);
      const endingBalance = toCents(input.endingBalance);
      const reconciledBalance = startingBalance + selectedTotal;

      if (endingBalance !== reconciledBalance) {
        throw new Error("Reconciliation difference must be exactly $0.00 before completion.");
      }

      const previousStatementId = await previousStatementIdFor(tx, lockedAccount);
      const [statement] = await tx
        .insert(accountStatements)
        .values({
          accountId: this.id,
          statementDate: input.statementDate,
          previousStatementId,
          startingBalance: toMoney(startingBalance / 100),
          endingBalance: toMoney(endingBalance / 100),
          reconciledBalance: toMoney(reconciledBalance / 100),
          reconciled: false,
          notes: input.notes ?? null
        })
        .returning({ id: accountStatements.id });

      if (!statement) throw new Error("Could not create statement.");

      if (selectedTransactionIds.length) {
        await tx
          .update(transactions)
          .set({ statementId: statement.id, status: "cleared", updatedAt: new Date() })
          .where(and(eq(transactions.accountId, this.id), inArray(transactions.id, selectedTransactionIds)));
      }

      await tx
        .update(accountStatements)
        .set({ reconciled: true, updatedAt: new Date() })
        .where(eq(accountStatements.id, statement.id));

      await tx
        .update(accounts)
        .set({
          statementChainBalance: toMoney(endingBalance / 100),
          lastReconciledDate: input.statementDate,
          lastReconciledStatementId: statement.id,
          updatedAt: new Date()
        })
        .where(eq(accounts.id, this.id));

      return { statementId: statement.id };
    });
  }
}

export const loadAccount = async (client: Client, accountId: string) => {
  const [account] = await client.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  return account ?? null;
};

const transactionRows = async (accountId: string, view: RegisterView | "statement", statementId?: string) => {
  const filters = [eq(transactions.accountId, accountId)];

  if (view === "active") {
    filters.push(isNull(transactions.statementId), ne(transactions.status, "void"));
  } else if (view === "all") {
    filters.push(ne(transactions.status, "void"));
  } else if (view === "void") {
    filters.push(eq(transactions.status, "void"));
  } else if (view === "statement" && statementId) {
    filters.push(eq(transactions.statementId, statementId));
  } else {
    filters.push(isNotNull(transactions.statementId));
  }

  return db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      date: transactions.date,
      amount: transactions.amount,
      status: transactions.status,
      statementId: transactions.statementId,
      payeeId: transactions.payeeId,
      payeeName: payees.name,
      description: transactions.description,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      notes: transactions.notes,
      createdAt: transactions.createdAt,
      updatedAt: transactions.updatedAt
    })
    .from(transactions)
    .innerJoin(payees, eq(transactions.payeeId, payees.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(...filters))
    .orderBy(asc(transactions.date), asc(transactions.createdAt), asc(transactions.id));
};
