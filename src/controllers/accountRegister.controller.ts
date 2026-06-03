import type { Request, Response } from "express";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, categories, transactions } from "../db/schema.js";
import {
  editableRegisterStatuses,
  findRegisterTransaction,
  getAccountRegister,
  voidableRegisterStatuses
} from "../services/accountRegister.service.js";
import {
  amountTypes,
  firstValidationMessage,
  paymentMethods,
  scheduleTypes,
  transactionSchema,
  transactionStatuses
} from "../validation/forms.js";

const today = () => new Date().toISOString().slice(0, 10);

const getFormData = async () => ({
  categories: await db.select().from(categories).where(eq(categories.active, true)).orderBy(asc(categories.name)),
  amountTypes,
  paymentMethods,
  scheduleTypes,
  statuses: transactionStatuses
});

const accountExists = async (accountId: string) => {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  return account ?? null;
};

const categoryExists = async (categoryId: string | null) => {
  if (!categoryId) return true;
  const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).limit(1);
  return Boolean(category);
};

const redirectToRegister = (accountId: string) => `/accounts/${accountId}/register`;
const queryFlag = (value: unknown, defaultValue: boolean) => {
  const lastValue = Array.isArray(value) ? value[value.length - 1] : value;
  if (lastValue === "true") return true;
  if (lastValue === "false") return false;
  return defaultValue;
};

export const showAccountRegister = async (req: Request, res: Response) => {
  const register = await getAccountRegister(req.params.accountId, {
    showFuture: queryFlag(req.query.showFuture, true),
    showVoid: queryFlag(req.query.showVoid, false)
  });

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
  const account = await accountExists(req.params.accountId);
  if (!account) {
    req.flash("error", "Account not found.");
    res.redirect("/accounts");
    return;
  }

  res.render("layout", {
    title: `New ${account.name} Transaction`,
    view: "accounts/register-form",
    account,
    transaction: {
      date: today(),
      accountId: account.id,
      status: "entered",
      amountType: "fixed",
      paymentMethod: "manual"
    },
    ...(await getFormData())
  });
};

export const createAccountRegisterTransaction = async (req: Request, res: Response) => {
  const account = await accountExists(req.params.accountId);
  if (!account) {
    req.flash("error", "Account not found.");
    res.redirect("/accounts");
    return;
  }

  const parsed = transactionSchema.safeParse({ ...req.body, accountId: account.id });
  if (!parsed.success || !(await categoryExists(parsed.success ? parsed.data.categoryId : null))) {
    req.flash("error", parsed.success ? "Category not found." : firstValidationMessage(parsed.error));
    res.status(422).render("layout", {
      title: `New ${account.name} Transaction`,
      view: "accounts/register-form",
      account,
      transaction: { ...req.body, accountId: account.id },
      ...(await getFormData())
    });
    return;
  }

  const data = parsed.data;
  await db.insert(transactions).values({
    date: data.date,
    description: data.description,
    amount: data.amount.toFixed(2),
    accountId: account.id,
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
  res.redirect(redirectToRegister(account.id));
};

export const editAccountRegisterTransaction = async (req: Request, res: Response) => {
  const account = await accountExists(req.params.accountId);
  const transaction = account ? await findRegisterTransaction(account.id, req.params.transactionId) : null;
  if (!account || !transaction) {
    req.flash("error", !account ? "Account not found." : "Register transaction not found.");
    res.redirect(!account ? "/accounts" : redirectToRegister(account.id));
    return;
  }

  if (!editableRegisterStatuses.includes(transaction.status as (typeof editableRegisterStatuses)[number])) {
    req.flash("error", "Statement and void transactions are locked and cannot be edited.");
    res.redirect(redirectToRegister(account.id));
    return;
  }

  res.render("layout", {
    title: `Edit ${account.name} Transaction`,
    view: "accounts/register-form",
    account,
    transaction,
    ...(await getFormData())
  });
};

export const updateAccountRegisterTransaction = async (req: Request, res: Response) => {
  const account = await accountExists(req.params.accountId);
  const existing = account ? await findRegisterTransaction(account.id, req.params.transactionId) : null;
  if (!account || !existing) {
    req.flash("error", !account ? "Account not found." : "Register transaction not found.");
    res.redirect(!account ? "/accounts" : redirectToRegister(account.id));
    return;
  }

  if (!editableRegisterStatuses.includes(existing.status as (typeof editableRegisterStatuses)[number])) {
    req.flash("error", "Statement and void transactions are locked and cannot be edited.");
    res.redirect(redirectToRegister(account.id));
    return;
  }

  const parsed = transactionSchema.safeParse({ ...req.body, accountId: account.id });
  if (!parsed.success || !(await categoryExists(parsed.success ? parsed.data.categoryId : null))) {
    req.flash("error", parsed.success ? "Category not found." : firstValidationMessage(parsed.error));
    res.status(422).render("layout", {
      title: `Edit ${account.name} Transaction`,
      view: "accounts/register-form",
      account,
      transaction: { ...req.body, id: existing.id, accountId: account.id },
      ...(await getFormData())
    });
    return;
  }

  const data = parsed.data;
  await db
    .update(transactions)
    .set({
      date: data.date,
      description: data.description,
      amount: data.amount.toFixed(2),
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
      notes: data.notes,
      updatedAt: new Date()
    })
    .where(eq(transactions.id, existing.id));

  req.flash("success", "Register transaction updated.");
  res.redirect(redirectToRegister(account.id));
};

export const voidAccountRegisterTransaction = async (req: Request, res: Response) => {
  const account = await accountExists(req.params.accountId);
  const transaction = account ? await findRegisterTransaction(account.id, req.params.transactionId) : null;
  if (!account || !transaction) {
    req.flash("error", !account ? "Account not found." : "Register transaction not found.");
    res.redirect(!account ? "/accounts" : redirectToRegister(account.id));
    return;
  }

  if (!voidableRegisterStatuses.includes(transaction.status as (typeof voidableRegisterStatuses)[number])) {
    req.flash("error", "Statement transactions cannot be voided.");
    res.redirect(redirectToRegister(account.id));
    return;
  }

  await db.update(transactions).set({ status: "void", updatedAt: new Date() }).where(eq(transactions.id, transaction.id));
  req.flash("success", "Register transaction voided.");
  res.redirect(redirectToRegister(account.id));
};
