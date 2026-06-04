import type { Request, Response } from "express";
import { and, asc, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, categories, transactions } from "../db/schema.js";
import { editableRegisterStatuses, voidableRegisterStatuses } from "../services/accountRegister.service.js";
import { getAllAccountWorkingBalances } from "../services/balance.service.js";
import {
  updateRecurringTransactionWithLifecycle,
  voidRecurringTransactionWithLifecycle
} from "../services/recurring.service.js";
import {
  amountTypes,
  firstValidationMessage,
  paymentMethods,
  scheduleTypes,
  transactionSchema
} from "../validation/forms.js";

const formTransactionStatuses = ["entered", "pending", "cleared", "recurring"] as const;

const getFormData = async (currentCategoryId?: string | null) => ({
  accounts: await db.select().from(accounts).where(eq(accounts.active, true)).orderBy(asc(accounts.name)),
  categories: await db
    .select()
    .from(categories)
    .where(currentCategoryId ? or(eq(categories.active, true), eq(categories.id, currentCategoryId)) : eq(categories.active, true))
    .orderBy(desc(categories.active), asc(categories.name)),
  amountTypes,
  paymentMethods,
  scheduleTypes,
  statuses: formTransactionStatuses
});

const categoryIsSelectable = async (categoryId: string | null, existingCategoryId?: string | null) => {
  if (!categoryId) return true;
  const [category] = await db.select({ id: categories.id, active: categories.active }).from(categories).where(eq(categories.id, categoryId)).limit(1);
  return Boolean(category?.active || (existingCategoryId && category?.id === existingCategoryId));
};

export const listTransactions = async (req: Request, res: Response) => {
  const accountId = typeof req.query.accountId === "string" && req.query.accountId ? req.query.accountId : undefined;
  const showVoid = req.query.showVoid === "on";
  const filters: SQL[] = [];

  if (accountId) filters.push(eq(transactions.accountId, accountId));
  filters.push(inArray(transactions.status, showVoid ? ["entered", "pending", "cleared", "recurring", "void"] : ["entered", "pending", "cleared", "recurring"]));

  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      description: transactions.description,
      amount: transactions.amount,
      transactionType: transactions.transactionType,
      status: transactions.status,
      amountType: transactions.amountType,
      accountName: accounts.name,
      categoryName: categories.name
    })
    .from(transactions)
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(transactions.date), desc(transactions.createdAt));

  const [registerAccounts, balances] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.active, true)).orderBy(asc(accounts.displayOrder), asc(accounts.name)),
    getAllAccountWorkingBalances()
  ]);

  res.render("layout", {
    title: "Register",
    view: "transactions/index",
    transactions: rows,
    accounts: registerAccounts,
    balances,
    filters: { accountId, showVoid }
  });
};

export const newTransaction = async (_req: Request, res: Response) => {
  res.render("layout", {
    title: "New Register Transaction",
    view: "transactions/form",
    transaction: { status: "entered", amountType: "fixed", paymentMethod: "manual" },
    ...(await getFormData())
  });
};

export const createTransaction = async (req: Request, res: Response) => {
  const parsed = transactionSchema.safeParse(req.body);
  if (!parsed.success || !formTransactionStatuses.includes(parsed.data.status as (typeof formTransactionStatuses)[number]) || !(await categoryIsSelectable(parsed.data.categoryId))) {
    req.flash(
      "error",
      parsed.success
        ? "Status must be entered, pending, cleared, or recurring; category must be active for new transactions."
        : firstValidationMessage(parsed.error)
    );
    res.status(422).render("layout", {
      title: "New Register Transaction",
      view: "transactions/form",
      transaction: req.body,
      ...(await getFormData())
    });
    return;
  }

  const data = parsed.data;
  await db.insert(transactions).values({
    date: data.date,
    description: data.description,
    amount: data.amount.toFixed(2),
    accountId: data.accountId,
    categoryId: data.categoryId,
    transactionType: data.transactionType,
    status: data.status,
    amountType: data.amountType,
    paymentMethod: data.paymentMethod,
    recurringGroupId: data.recurringGroupId,
    frequency: data.frequency,
    recurringEndDate: data.recurringEndDate,
    dayOfMonth: data.dayOfMonth,
    secondDayOfMonth: data.secondDayOfMonth,
    source: data.source,
    sourceRowHash: data.sourceRowHash,
    notes: data.notes
  });
  req.flash("success", "Register transaction created.");
  res.redirect("/transactions");
};

export const editTransaction = async (req: Request, res: Response) => {
  const [transaction] = await db.select().from(transactions).where(eq(transactions.id, req.params.id)).limit(1);
  if (!transaction) {
    req.flash("error", "Register transaction not found.");
    res.redirect("/transactions");
    return;
  }

  if (!editableRegisterStatuses.includes(transaction.status as (typeof editableRegisterStatuses)[number])) {
    req.flash("error", "Statement and void transactions are locked and cannot be edited.");
    res.redirect("/transactions");
    return;
  }

  res.render("layout", {
    title: "Edit Register Transaction",
    view: "transactions/form",
    transaction,
    ...(await getFormData(transaction.categoryId))
  });
};

export const updateTransaction = async (req: Request, res: Response) => {
  const [existing] = await db.select().from(transactions).where(eq(transactions.id, req.params.id)).limit(1);
  if (!existing) {
    req.flash("error", "Register transaction not found.");
    res.redirect("/transactions");
    return;
  }

  if (!editableRegisterStatuses.includes(existing.status as (typeof editableRegisterStatuses)[number])) {
    req.flash("error", "Statement and void transactions are locked and cannot be edited.");
    res.redirect("/transactions");
    return;
  }

  const parsed = transactionSchema.safeParse(req.body);
  if (!parsed.success || !formTransactionStatuses.includes(parsed.data.status as (typeof formTransactionStatuses)[number]) || !(await categoryIsSelectable(parsed.data.categoryId, existing.categoryId))) {
    req.flash(
      "error",
      parsed.success
        ? "Status must be entered, pending, cleared, or recurring; category must be active unless it is already assigned to this transaction."
        : firstValidationMessage(parsed.error)
    );
    res.status(422).render("layout", {
      title: "Edit Register Transaction",
      view: "transactions/form",
      transaction: { ...req.body, id: req.params.id },
      ...(await getFormData(existing.categoryId))
    });
    return;
  }

  const data = parsed.data;
  const updateValues = {
    date: data.date,
    description: data.description,
    amount: data.amount.toFixed(2),
    accountId: data.accountId,
    categoryId: data.categoryId,
    transactionType: data.transactionType,
    status: data.status,
    amountType: data.amountType,
    paymentMethod: data.paymentMethod,
    recurringGroupId: data.recurringGroupId,
    frequency: data.frequency,
    recurringEndDate: data.recurringEndDate,
    dayOfMonth: data.dayOfMonth,
    secondDayOfMonth: data.secondDayOfMonth,
    source: data.source,
    sourceRowHash: data.sourceRowHash,
    notes: data.notes
  };
  const editScope = req.body.recurringEditScope === "future" ? "future" : "this";
  if (existing.recurringGroupId) {
    await updateRecurringTransactionWithLifecycle(existing, updateValues, editScope);
  } else {
    await db.update(transactions).set({ ...updateValues, updatedAt: new Date() }).where(eq(transactions.id, req.params.id));
  }
  req.flash("success", "Register transaction updated.");
  res.redirect("/transactions");
};

export const voidTransaction = async (req: Request, res: Response) => {
  const [transaction] = await db.select().from(transactions).where(eq(transactions.id, req.params.id)).limit(1);
  if (!transaction) {
    req.flash("error", "Register transaction not found.");
    res.redirect("/transactions");
    return;
  }

  if (!voidableRegisterStatuses.includes(transaction.status as (typeof voidableRegisterStatuses)[number])) {
    req.flash("error", "Statement transactions cannot be voided.");
    res.redirect("/transactions");
    return;
  }

  if (transaction.recurringGroupId) {
    await voidRecurringTransactionWithLifecycle(transaction);
  } else {
    await db
      .update(transactions)
      .set({ status: "void", updatedAt: new Date() })
      .where(eq(transactions.id, req.params.id));
  }
  req.flash("success", "Register transaction voided.");
  res.redirect("/transactions");
};
