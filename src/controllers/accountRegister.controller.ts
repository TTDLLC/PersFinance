import type { Request, Response } from "express";
import { asc, desc, eq, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { categories, payees, transactions } from "../db/schema.js";
import { Accounts } from "../services/accounts.service.js";
import {
  editableRegisterStatuses,
  findRegisterTransaction,
  getAccountRegister,
  voidableRegisterStatuses
} from "../services/accountRegister.service.js";
import {
  firstValidationMessage,
  transactionSchema,
  transactionStatuses
} from "../validation/forms.js";

const today = () => new Date().toISOString().slice(0, 10);
const toMoney = (value: number) => value.toFixed(2);

const selectedView = (value: unknown) => {
  const option = Array.isArray(value) ? value[value.length - 1] : value;
  if (option === "all" || option === "void") return option;
  return "active";
};

const getFormData = async (currentCategoryId?: string | null, currentPayeeId?: string | null) => ({
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

const redirectToRegister = (accountId: string) => `/accounts/${accountId}/register`;

export const showAccountRegister = async (req: Request, res: Response) => {
  const register = await getAccountRegister(req.params.accountId, selectedView(req.query.view));

  if (!register) {
    req.flash("error", "Account not found.");
    res.redirect("/accounts");
    return;
  }

  res.render("layout", {
    title: `${register.account.name} Register`,
    view: "accounts/register",
    register
  });
};

export const newAccountRegisterTransaction = async (req: Request, res: Response) => {
  const account = await Accounts.getAccount(req.params.accountId);
  if (!account) {
    req.flash("error", "Account not found.");
    res.redirect("/accounts");
    return;
  }

  res.render("layout", {
    title: `New ${account.data.name} Transaction`,
    view: "accounts/register-form",
    account: account.data,
    transaction: {
      date: today(),
      accountId: account.id,
      status: "entered"
    },
    ...(await getFormData())
  });
};

export const createAccountRegisterTransaction = async (req: Request, res: Response) => {
  const account = await Accounts.getAccount(req.params.accountId);
  if (!account) {
    req.flash("error", "Account not found.");
    res.redirect("/accounts");
    return;
  }

  const parsed = transactionSchema.safeParse({ ...req.body, accountId: account.id });
  if (!parsed.success || parsed.data.status === "void" || !(await categoryIsSelectable(parsed.data.categoryId))) {
    req.flash(
      "error",
      parsed.success ? "Status must be entered, pending, or cleared; category must be active for new transactions." : firstValidationMessage(parsed.error)
    );
    res.status(422).render("layout", {
      title: `New ${account.data.name} Transaction`,
      view: "accounts/register-form",
      account: account.data,
      transaction: { ...req.body, accountId: account.id },
      ...(await getFormData())
    });
    return;
  }

  const data = parsed.data;
  await db.insert(transactions).values({
    date: data.date,
    amount: toMoney(data.amount),
    accountId: account.id,
    payeeId: data.payeeId,
    description: data.description,
    categoryId: data.categoryId,
    status: data.status,
    notes: data.notes
  });

  req.flash("success", "Register transaction created.");
  res.redirect(redirectToRegister(account.id));
};

export const editAccountRegisterTransaction = async (req: Request, res: Response) => {
  const account = await Accounts.getAccount(req.params.accountId);
  const transaction = account ? await findRegisterTransaction(account.id, req.params.transactionId) : null;
  if (!account || !transaction) {
    req.flash("error", !account ? "Account not found." : "Register transaction not found.");
    res.redirect(!account ? "/accounts" : redirectToRegister(account.id));
    return;
  }

  if (!editableRegisterStatuses.includes(transaction.status as (typeof editableRegisterStatuses)[number]) || transaction.statementId) {
    req.flash("error", "Reconciled and void transactions are locked and cannot be edited.");
    res.redirect(redirectToRegister(account.id));
    return;
  }

  res.render("layout", {
    title: `Edit ${account.data.name} Transaction`,
    view: "accounts/register-form",
    account: account.data,
    transaction,
    ...(await getFormData(transaction.categoryId, transaction.payeeId))
  });
};

export const updateAccountRegisterTransaction = async (req: Request, res: Response) => {
  const account = await Accounts.getAccount(req.params.accountId);
  const existing = account ? await findRegisterTransaction(account.id, req.params.transactionId) : null;
  if (!account || !existing) {
    req.flash("error", !account ? "Account not found." : "Register transaction not found.");
    res.redirect(!account ? "/accounts" : redirectToRegister(account.id));
    return;
  }

  if (!editableRegisterStatuses.includes(existing.status as (typeof editableRegisterStatuses)[number]) || existing.statementId) {
    req.flash("error", "Reconciled and void transactions are locked and cannot be edited.");
    res.redirect(redirectToRegister(account.id));
    return;
  }

  const parsed = transactionSchema.safeParse({ ...req.body, accountId: account.id });
  if (!parsed.success || parsed.data.status === "void" || !(await categoryIsSelectable(parsed.data.categoryId, existing.categoryId))) {
    req.flash(
      "error",
      parsed.success ? "Status must be entered, pending, or cleared; category must be active unless already assigned." : firstValidationMessage(parsed.error)
    );
    res.status(422).render("layout", {
      title: `Edit ${account.data.name} Transaction`,
      view: "accounts/register-form",
      account: account.data,
      transaction: { ...req.body, id: existing.id, accountId: account.id },
      ...(await getFormData(existing.categoryId, existing.payeeId))
    });
    return;
  }

  const data = parsed.data;
  await db
    .update(transactions)
    .set({
      date: data.date,
      amount: toMoney(data.amount),
      payeeId: data.payeeId,
      description: data.description,
      categoryId: data.categoryId,
      status: data.status,
      notes: data.notes,
      updatedAt: new Date()
    })
    .where(eq(transactions.id, existing.id));

  req.flash("success", "Register transaction updated.");
  res.redirect(redirectToRegister(account.id));
};

export const voidAccountRegisterTransaction = async (req: Request, res: Response) => {
  const account = await Accounts.getAccount(req.params.accountId);
  const transaction = account ? await findRegisterTransaction(account.id, req.params.transactionId) : null;
  if (!account || !transaction) {
    req.flash("error", !account ? "Account not found." : "Register transaction not found.");
    res.redirect(!account ? "/accounts" : redirectToRegister(account.id));
    return;
  }

  if (!voidableRegisterStatuses.includes(transaction.status as (typeof voidableRegisterStatuses)[number]) || transaction.statementId) {
    req.flash("error", "Reconciled transactions cannot be voided.");
    res.redirect(redirectToRegister(account.id));
    return;
  }

  await db.update(transactions).set({ status: "void", updatedAt: new Date() }).where(eq(transactions.id, transaction.id));
  req.flash("success", "Register transaction voided.");
  res.redirect(redirectToRegister(account.id));
};
