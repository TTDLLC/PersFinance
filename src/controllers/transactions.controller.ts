import type { Request, Response } from "express";
import { and, asc, desc, eq, isNull, ne, or, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, categories, payees, transactions } from "../db/schema.js";
import { editableRegisterStatuses, voidableRegisterStatuses } from "../services/accountRegister.service.js";
import { firstValidationMessage, transactionSchema, transactionStatuses } from "../validation/forms.js";

const toMoney = (value: number) => value.toFixed(2);
const today = () => new Date().toISOString().slice(0, 10);

const getFormData = async (currentCategoryId?: string | null, currentPayeeId?: string | null) => ({
  accounts: await db.select().from(accounts).where(eq(accounts.active, true)).orderBy(asc(accounts.name)),
  categories: await db
    .select()
    .from(categories)
    .where(currentCategoryId ? or(eq(categories.active, true), eq(categories.id, currentCategoryId)) : eq(categories.active, true))
    .orderBy(desc(categories.active), asc(categories.name)),
  payees: await db
    .select()
    .from(payees)
    .where(currentPayeeId ? or(eq(payees.active, true), eq(payees.id, currentPayeeId)) : eq(payees.active, true))
    .orderBy(desc(payees.active), asc(payees.name)),
  statuses: transactionStatuses.filter((status) => status !== "void")
});

const categoryIsSelectable = async (categoryId: string | null, existingCategoryId?: string | null) => {
  if (!categoryId) return true;
  const [category] = await db.select({ id: categories.id, active: categories.active }).from(categories).where(eq(categories.id, categoryId)).limit(1);
  return Boolean(category?.active || (existingCategoryId && category?.id === existingCategoryId));
};

export const listTransactions = async (req: Request, res: Response) => {
  const accountId = typeof req.query.accountId === "string" && req.query.accountId ? req.query.accountId : undefined;
  const viewMode = req.query.view === "all" || req.query.view === "void" ? req.query.view : "active";
  const filters: SQL[] = [];

  if (accountId) filters.push(eq(transactions.accountId, accountId));
  if (viewMode === "active") filters.push(isNull(transactions.statementId), ne(transactions.status, "void"));
  if (viewMode === "all") filters.push(ne(transactions.status, "void"));
  if (viewMode === "void") filters.push(eq(transactions.status, "void"));

  const rows = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      date: transactions.date,
      amount: transactions.amount,
      status: transactions.status,
      statementId: transactions.statementId,
      description: transactions.description,
      accountName: accounts.name,
      payeeName: payees.name,
      categoryName: categories.name,
      transferId: transactions.transferId
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(payees, eq(transactions.payeeId, payees.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(transactions.date), desc(transactions.createdAt));

  const registerAccounts = await db.select().from(accounts).where(eq(accounts.active, true)).orderBy(asc(accounts.displayOrder), asc(accounts.name));

  res.render("layout", {
    title: "Register",
    view: "transactions/index",
    transactions: rows,
    accounts: registerAccounts,
    filters: { accountId, view: viewMode }
  });
};

export const newTransaction = async (_req: Request, res: Response) => {
  res.render("layout", {
    title: "New Register Transaction",
    view: "transactions/form",
    transaction: { status: "entered", date: today() },
    ...(await getFormData())
  });
};

export const createTransaction = async (req: Request, res: Response) => {
  const parsed = transactionSchema.safeParse(req.body);
  if (!parsed.success || !parsed.data.accountId || parsed.data.status === "void" || !(await categoryIsSelectable(parsed.data.categoryId))) {
    req.flash(
      "error",
      parsed.success ? "Account, payee, status, and active category selection are required." : firstValidationMessage(parsed.error)
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
  const accountId = data.accountId;
  if (!accountId) throw new Error("Account is required.");
  await db.insert(transactions).values({
    date: data.date,
    amount: toMoney(data.amount),
    accountId,
    payeeId: data.payeeId,
    description: data.description,
    categoryId: data.categoryId,
    status: data.status,
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

  if (!editableRegisterStatuses.includes(transaction.status as (typeof editableRegisterStatuses)[number]) || transaction.statementId) {
    req.flash("error", "Reconciled and void transactions are locked and cannot be edited.");
    res.redirect("/transactions");
    return;
  }
  if (transaction.transferId) {
    res.redirect(`/accounts/${transaction.accountId}/register/transfers/${transaction.transferId}/edit`);
    return;
  }

  res.render("layout", {
    title: "Edit Register Transaction",
    view: "transactions/form",
    transaction,
    ...(await getFormData(transaction.categoryId, transaction.payeeId))
  });
};

export const updateTransaction = async (req: Request, res: Response) => {
  const [existing] = await db.select().from(transactions).where(eq(transactions.id, req.params.id)).limit(1);
  if (!existing) {
    req.flash("error", "Register transaction not found.");
    res.redirect("/transactions");
    return;
  }

  if (!editableRegisterStatuses.includes(existing.status as (typeof editableRegisterStatuses)[number]) || existing.statementId) {
    req.flash("error", "Reconciled and void transactions are locked and cannot be edited.");
    res.redirect("/transactions");
    return;
  }
  if (existing.transferId) {
    req.flash("error", "Transfers must be edited through the transfer workflow.");
    res.redirect("/transactions");
    return;
  }

  const parsed = transactionSchema.safeParse(req.body);
  if (!parsed.success || !parsed.data.accountId || parsed.data.status === "void" || !(await categoryIsSelectable(parsed.data.categoryId, existing.categoryId))) {
    req.flash(
      "error",
      parsed.success ? "Account, payee, status, and category selection are required." : firstValidationMessage(parsed.error)
    );
    res.status(422).render("layout", {
      title: "Edit Register Transaction",
      view: "transactions/form",
      transaction: { ...req.body, id: req.params.id },
      ...(await getFormData(existing.categoryId, existing.payeeId))
    });
    return;
  }

  const data = parsed.data;
  const accountId = data.accountId;
  if (!accountId) throw new Error("Account is required.");
  await db
    .update(transactions)
    .set({
      date: data.date,
      amount: toMoney(data.amount),
      accountId,
      payeeId: data.payeeId,
      description: data.description,
      categoryId: data.categoryId,
      status: data.status,
      notes: data.notes,
      updatedAt: new Date()
    })
    .where(eq(transactions.id, req.params.id));
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

  if (!voidableRegisterStatuses.includes(transaction.status as (typeof voidableRegisterStatuses)[number]) || transaction.statementId) {
    req.flash("error", "Reconciled transactions cannot be voided.");
    res.redirect("/transactions");
    return;
  }
  if (transaction.transferId) {
    req.flash("error", "Transfers must be deleted through the transfer workflow.");
    res.redirect("/transactions");
    return;
  }

  await db.update(transactions).set({ status: "void", updatedAt: new Date() }).where(eq(transactions.id, req.params.id));
  req.flash("success", "Register transaction voided.");
  res.redirect("/transactions");
};
