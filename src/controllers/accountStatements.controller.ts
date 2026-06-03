import type { Request, Response } from "express";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { accountBalanceSnapshots, accounts, accountStatements, transactions } from "../db/schema.js";
import { firstValidationMessage, reconciliationSchema } from "../validation/forms.js";

const eligibleStatuses: Array<"entered" | "pending" | "cleared"> = ["entered", "pending", "cleared"];

const toNumber = (value: string | number | null | undefined) => Number(value ?? 0);
const toCents = (value: string | number | null | undefined) => Math.round(toNumber(value) * 100);
const today = () => new Date().toISOString().slice(0, 10);
const selectedIdsFromForm = (value: unknown) => {
  if (value === undefined || value === "") return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
};

const accountExists = async (accountId: string) => {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  return account ?? null;
};

const latestSnapshotForAccount = async (accountId: string) => {
  const [snapshot] = await db
    .select()
    .from(accountBalanceSnapshots)
    .where(eq(accountBalanceSnapshots.accountId, accountId))
    .orderBy(desc(accountBalanceSnapshots.snapshotDate), desc(accountBalanceSnapshots.createdAt))
    .limit(1);
  return snapshot ?? null;
};

const eligibleTransactionsForAccount = async (accountId: string) =>
  db
    .select({
      id: transactions.id,
      date: transactions.date,
      description: transactions.description,
      amount: transactions.amount,
      status: transactions.status
    })
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), inArray(transactions.status, eligibleStatuses)))
    .orderBy(asc(transactions.date), asc(transactions.id));

const loadReconciliationData = async (
  accountId: string,
  values: { statementDate?: string; endingBalance?: string | number; selectedTransactionIds?: string[] }
) => {
  const [account, latestSnapshot, eligibleTransactions] = await Promise.all([
    accountExists(accountId),
    latestSnapshotForAccount(accountId),
    eligibleTransactionsForAccount(accountId)
  ]);
  if (!account) return null;

  const selectedIds = new Set(values.selectedTransactionIds ?? []);
  const selectedTotalCents = eligibleTransactions.reduce(
    (sum, transaction) => sum + (selectedIds.has(transaction.id) ? toCents(transaction.amount) : 0),
    0
  );
  const latestSnapshotCents = toCents(latestSnapshot?.balance);
  const calculatedReconciledCents = latestSnapshotCents + selectedTotalCents;
  const endingBalanceCents = toCents(values.endingBalance);

  return {
    account,
    statementDate: values.statementDate || today(),
    endingBalance: (values.endingBalance ?? toNumber(latestSnapshot?.balance)).toString(),
    latestSnapshotDate: latestSnapshot?.snapshotDate ?? null,
    latestSnapshotBalance: toNumber(latestSnapshot?.balance),
    calculatedReconciledBalance: calculatedReconciledCents / 100,
    difference: (endingBalanceCents - calculatedReconciledCents) / 100,
    selectedTransactionIds: selectedIds,
    eligibleTransactions: eligibleTransactions.map((transaction) => ({
      ...transaction,
      amount: toNumber(transaction.amount)
    }))
  };
};

export const showAccountReconciliation = async (req: Request, res: Response) => {
  const data = await loadReconciliationData(req.params.accountId, {
    statementDate: typeof req.query.statementDate === "string" ? req.query.statementDate : today(),
    endingBalance: typeof req.query.endingBalance === "string" ? req.query.endingBalance : undefined
  });

  if (!data) {
    req.flash("error", "Account not found.");
    res.redirect("/accounts");
    return;
  }

  res.render("layout", {
    title: `${data.account.name} Reconciliation`,
    view: "accounts/reconcile",
    reconciliation: data
  });
};

export const completeAccountReconciliation = async (req: Request, res: Response) => {
  const account = await accountExists(req.params.accountId);
  if (!account) {
    req.flash("error", "Account not found.");
    res.redirect("/accounts");
    return;
  }

  const parsed = reconciliationSchema.safeParse(req.body);
  if (!parsed.success) {
    req.flash("error", firstValidationMessage(parsed.error));
    const data = await loadReconciliationData(account.id, {
      statementDate: req.body.statementDate,
      endingBalance: req.body.endingBalance,
      selectedTransactionIds: selectedIdsFromForm(req.body.selectedTransactionIds)
    });
    res.status(422).render("layout", {
      title: `${account.name} Reconciliation`,
      view: "accounts/reconcile",
      reconciliation: data
    });
    return;
  }

  const selectedTransactionIds = [...new Set(parsed.data.selectedTransactionIds)];
  const selectedTransactions = selectedTransactionIds.length
    ? await db
        .select({
          id: transactions.id,
          amount: transactions.amount
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.accountId, account.id),
            inArray(transactions.id, selectedTransactionIds),
            inArray(transactions.status, eligibleStatuses)
          )
        )
    : [];

  if (selectedTransactions.length !== selectedTransactionIds.length) {
    req.flash("error", "Selected transactions must belong to this account and be entered, pending, or cleared.");
    const data = await loadReconciliationData(account.id, {
      statementDate: parsed.data.statementDate,
      endingBalance: parsed.data.endingBalance,
      selectedTransactionIds
    });
    res.status(422).render("layout", {
      title: `${account.name} Reconciliation`,
      view: "accounts/reconcile",
      reconciliation: data
    });
    return;
  }

  const latestSnapshot = await latestSnapshotForAccount(account.id);
  const selectedTotalCents = selectedTransactions.reduce((sum, transaction) => sum + toCents(transaction.amount), 0);
  const calculatedReconciledCents = toCents(latestSnapshot?.balance) + selectedTotalCents;
  const endingBalanceCents = toCents(parsed.data.endingBalance);

  if (endingBalanceCents - calculatedReconciledCents !== 0) {
    req.flash("error", "Reconciliation difference must be exactly $0.00 before completion.");
    const data = await loadReconciliationData(account.id, {
      statementDate: parsed.data.statementDate,
      endingBalance: parsed.data.endingBalance,
      selectedTransactionIds
    });
    res.status(422).render("layout", {
      title: `${account.name} Reconciliation`,
      view: "accounts/reconcile",
      reconciliation: data
    });
    return;
  }

  await db.transaction(async (tx) => {
    const [statement] = await tx
      .insert(accountStatements)
      .values({
        accountId: account.id,
        statementDate: parsed.data.statementDate,
        endingBalance: parsed.data.endingBalance.toFixed(2)
      })
      .returning({ id: accountStatements.id });

    await tx.insert(accountBalanceSnapshots).values({
      accountId: account.id,
      snapshotDate: parsed.data.statementDate,
      balance: parsed.data.endingBalance.toFixed(2),
      source: "statement-reconciliation",
      notes: `Statement ${statement.id}`
    });

    if (selectedTransactionIds.length) {
      await tx
        .update(transactions)
        .set({ status: "statement", statementId: statement.id, updatedAt: new Date() })
        .where(and(eq(transactions.accountId, account.id), inArray(transactions.id, selectedTransactionIds)));
    }
  });

  req.flash("success", "Statement reconciled.");
  res.redirect(`/accounts/${account.id}/statements`);
};

export const listAccountStatements = async (req: Request, res: Response) => {
  const account = await accountExists(req.params.accountId);
  if (!account) {
    req.flash("error", "Account not found.");
    res.redirect("/accounts");
    return;
  }

  const statements = await db
    .select({
      id: accountStatements.id,
      statementDate: accountStatements.statementDate,
      endingBalance: accountStatements.endingBalance,
      reconciledAt: accountStatements.reconciledAt,
      transactionCount: sql<number>`count(${transactions.id})::int`
    })
    .from(accountStatements)
    .leftJoin(transactions, eq(transactions.statementId, accountStatements.id))
    .where(eq(accountStatements.accountId, account.id))
    .groupBy(accountStatements.id)
    .orderBy(desc(accountStatements.statementDate), desc(accountStatements.reconciledAt));

  res.render("layout", {
    title: `${account.name} Statements`,
    view: "accounts/statements",
    account,
    statements: statements.map((statement) => ({
      ...statement,
      endingBalance: toNumber(statement.endingBalance)
    }))
  });
};

export const showAccountStatement = async (req: Request, res: Response) => {
  const account = await accountExists(req.params.accountId);
  if (!account) {
    req.flash("error", "Account not found.");
    res.redirect("/accounts");
    return;
  }

  const [statement] = await db
    .select()
    .from(accountStatements)
    .where(and(eq(accountStatements.id, req.params.statementId), eq(accountStatements.accountId, account.id)))
    .limit(1);

  if (!statement) {
    req.flash("error", "Statement not found.");
    res.redirect(`/accounts/${account.id}/statements`);
    return;
  }

  const statementTransactions = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      description: transactions.description,
      amount: transactions.amount,
      status: transactions.status
    })
    .from(transactions)
    .where(eq(transactions.statementId, statement.id))
    .orderBy(asc(transactions.date), asc(transactions.id));

  res.render("layout", {
    title: `${account.name} Statement`,
    view: "accounts/statement-detail",
    account,
    statement: {
      ...statement,
      endingBalance: toNumber(statement.endingBalance)
    },
    transactions: statementTransactions.map((transaction) => ({
      ...transaction,
      amount: toNumber(transaction.amount)
    }))
  });
};
