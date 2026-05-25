import type { Request, Response } from "express";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, categories, futureTransactions, scenarios } from "../db/schema.js";
import {
  firstValidationMessage,
  futureTransactionSchema,
  futureTransactionStatuses,
  futureTransactionTypes
} from "../validation/forms.js";

const getFormData = async () => ({
  accounts: await db.select().from(accounts).where(eq(accounts.active, true)).orderBy(asc(accounts.name)),
  categories: await db.select().from(categories).where(eq(categories.active, true)).orderBy(asc(categories.name)),
  scenarios: await db.select().from(scenarios).where(eq(scenarios.active, true)).orderBy(asc(scenarios.name)),
  transactionTypes: futureTransactionTypes,
  statuses: futureTransactionStatuses
});

export const listFutureTransactions = async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: futureTransactions.id,
      date: futureTransactions.date,
      description: futureTransactions.description,
      amount: futureTransactions.amount,
      transactionType: futureTransactions.transactionType,
      status: futureTransactions.status,
      includeInProjection: futureTransactions.includeInProjection,
      accountName: accounts.name,
      categoryName: categories.name,
      scenarioName: scenarios.name
    })
    .from(futureTransactions)
    .leftJoin(accounts, eq(futureTransactions.accountId, accounts.id))
    .leftJoin(categories, eq(futureTransactions.categoryId, categories.id))
    .leftJoin(scenarios, eq(futureTransactions.scenarioId, scenarios.id))
    .orderBy(asc(futureTransactions.date));
  res.render("layout", { title: "Future Transactions", view: "future-transactions/index", futureTransactions: rows });
};

export const newFutureTransaction = async (_req: Request, res: Response) => {
  res.render("layout", { title: "New Future Transaction", view: "future-transactions/form", futureTransaction: {}, ...(await getFormData()) });
};

export const createFutureTransaction = async (req: Request, res: Response) => {
  const parsed = futureTransactionSchema.safeParse(req.body);
  if (!parsed.success) {
    req.flash("error", firstValidationMessage(parsed.error));
    res.status(422).render("layout", {
      title: "New Future Transaction",
      view: "future-transactions/form",
      futureTransaction: req.body,
      ...(await getFormData())
    });
    return;
  }

  const data = parsed.data;
  await db.insert(futureTransactions).values({
    date: data.date,
    description: data.description,
    amount: data.amount.toFixed(2),
    accountId: data.accountId,
    categoryId: data.categoryId,
    transactionType: data.transactionType,
    status: data.status,
    scenarioId: data.scenarioId,
    includeInProjection: data.includeInProjection,
    notes: data.notes
  });
  req.flash("success", "Future transaction created.");
  res.redirect("/future-transactions");
};

export const editFutureTransaction = async (req: Request, res: Response) => {
  const [futureTransaction] = await db.select().from(futureTransactions).where(eq(futureTransactions.id, req.params.id)).limit(1);
  if (!futureTransaction) {
    req.flash("error", "Future transaction not found.");
    res.redirect("/future-transactions");
    return;
  }
  res.render("layout", { title: "Edit Future Transaction", view: "future-transactions/form", futureTransaction, ...(await getFormData()) });
};

export const updateFutureTransaction = async (req: Request, res: Response) => {
  const parsed = futureTransactionSchema.safeParse(req.body);
  if (!parsed.success) {
    req.flash("error", firstValidationMessage(parsed.error));
    res.status(422).render("layout", {
      title: "Edit Future Transaction",
      view: "future-transactions/form",
      futureTransaction: { ...req.body, id: req.params.id },
      ...(await getFormData())
    });
    return;
  }

  const data = parsed.data;
  await db
    .update(futureTransactions)
    .set({
      date: data.date,
      description: data.description,
      amount: data.amount.toFixed(2),
      accountId: data.accountId,
      categoryId: data.categoryId,
      transactionType: data.transactionType,
      status: data.status,
      scenarioId: data.scenarioId,
      includeInProjection: data.includeInProjection,
      notes: data.notes,
      updatedAt: new Date()
    })
    .where(eq(futureTransactions.id, req.params.id));
  req.flash("success", "Future transaction updated.");
  res.redirect("/future-transactions");
};

export const deleteFutureTransaction = async (req: Request, res: Response) => {
  await db.delete(futureTransactions).where(eq(futureTransactions.id, req.params.id));
  req.flash("success", "Future transaction deleted.");
  res.redirect("/future-transactions");
};
