import type { Request, Response } from "express";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, categories, recurringTransactions } from "../db/schema.js";
import {
  amountTypes,
  firstValidationMessage,
  paymentMethods,
  recurringKinds,
  recurringSchema,
  recurringStatuses,
  scheduleTypes
} from "../validation/forms.js";

const getFormData = async () => ({
  accounts: await db.select().from(accounts).where(eq(accounts.active, true)).orderBy(asc(accounts.name)),
  categories: await db.select().from(categories).where(eq(categories.active, true)).orderBy(asc(categories.name)),
  kinds: recurringKinds,
  amountTypes,
  scheduleTypes,
  paymentMethods,
  statuses: recurringStatuses
});

export const listRecurring = async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: recurringTransactions.id,
      name: recurringTransactions.name,
      kind: recurringTransactions.kind,
      amount: recurringTransactions.amount,
      scheduleType: recurringTransactions.scheduleType,
      startDate: recurringTransactions.startDate,
      status: recurringTransactions.status,
      active: recurringTransactions.active,
      accountName: accounts.name,
      categoryName: categories.name
    })
    .from(recurringTransactions)
    .leftJoin(accounts, eq(recurringTransactions.accountId, accounts.id))
    .leftJoin(categories, eq(recurringTransactions.categoryId, categories.id))
    .orderBy(asc(recurringTransactions.name));
  res.render("layout", { title: "Recurring", view: "recurring/index", recurring: rows });
};

export const newRecurring = async (_req: Request, res: Response) => {
  res.render("layout", {
    title: "New Recurring Transaction",
    view: "recurring/form",
    recurring: {},
    ...(await getFormData())
  });
};

export const createRecurring = async (req: Request, res: Response) => {
  const parsed = recurringSchema.safeParse(req.body);
  if (!parsed.success) {
    req.flash("error", firstValidationMessage(parsed.error));
    res.status(422).render("layout", {
      title: "New Recurring Transaction",
      view: "recurring/form",
      recurring: req.body,
      ...(await getFormData())
    });
    return;
  }

  const data = parsed.data;
  await db.insert(recurringTransactions).values({
    name: data.name,
    kind: data.kind,
    amount: data.amount.toFixed(2),
    amountType: data.amountType,
    scheduleType: data.scheduleType,
    dayOfMonth: data.dayOfMonth,
    secondDayOfMonth: data.secondDayOfMonth,
    startDate: data.startDate,
    endDate: data.endDate,
    accountId: data.accountId,
    categoryId: data.categoryId,
    paymentMethod: data.paymentMethod,
    status: data.status,
    notes: data.notes
  });
  req.flash("success", "Recurring transaction created.");
  res.redirect("/recurring");
};

export const editRecurring = async (req: Request, res: Response) => {
  const [recurring] = await db
    .select()
    .from(recurringTransactions)
    .where(eq(recurringTransactions.id, req.params.id))
    .limit(1);
  if (!recurring) {
    req.flash("error", "Recurring transaction not found.");
    res.redirect("/recurring");
    return;
  }
  res.render("layout", {
    title: "Edit Recurring Transaction",
    view: "recurring/form",
    recurring,
    ...(await getFormData())
  });
};

export const updateRecurring = async (req: Request, res: Response) => {
  const parsed = recurringSchema.safeParse(req.body);
  if (!parsed.success) {
    req.flash("error", firstValidationMessage(parsed.error));
    res.status(422).render("layout", {
      title: "Edit Recurring Transaction",
      view: "recurring/form",
      recurring: { ...req.body, id: req.params.id, active: true },
      ...(await getFormData())
    });
    return;
  }

  const data = parsed.data;
  await db
    .update(recurringTransactions)
    .set({
      name: data.name,
      kind: data.kind,
      amount: data.amount.toFixed(2),
      amountType: data.amountType,
      scheduleType: data.scheduleType,
      dayOfMonth: data.dayOfMonth,
      secondDayOfMonth: data.secondDayOfMonth,
      startDate: data.startDate,
      endDate: data.endDate,
      accountId: data.accountId,
      categoryId: data.categoryId,
      paymentMethod: data.paymentMethod,
      status: data.status,
      notes: data.notes,
      updatedAt: new Date()
    })
    .where(eq(recurringTransactions.id, req.params.id));
  req.flash("success", "Recurring transaction updated.");
  res.redirect("/recurring");
};

export const archiveRecurring = async (req: Request, res: Response) => {
  await db
    .update(recurringTransactions)
    .set({ active: false, status: "archived", updatedAt: new Date() })
    .where(eq(recurringTransactions.id, req.params.id));
  req.flash("success", "Recurring transaction archived.");
  res.redirect("/recurring");
};
