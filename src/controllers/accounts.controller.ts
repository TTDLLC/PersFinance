import type { Request, Response } from "express";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts } from "../db/schema.js";
import { accountSchema, accountTypes, firstValidationMessage } from "../validation/forms.js";

export const listAccounts = async (_req: Request, res: Response) => {
  const rows = await db.select().from(accounts).orderBy(asc(accounts.displayOrder), asc(accounts.name));
  res.render("layout", { title: "Accounts", view: "accounts/index", accounts: rows });
};

export const newAccount = (_req: Request, res: Response) => {
  res.render("layout", { title: "New Account", view: "accounts/form", account: {}, accountTypes });
};

export const createAccount = async (req: Request, res: Response) => {
  const parsed = accountSchema.safeParse(req.body);
  if (!parsed.success) {
    req.flash("error", firstValidationMessage(parsed.error));
    res.status(422).render("layout", { title: "New Account", view: "accounts/form", account: req.body, accountTypes });
    return;
  }

  const data = parsed.data;
  await db.insert(accounts).values({
    name: data.name,
    type: data.type,
    startingBalance: data.startingBalance.toFixed(2),
    currentBalance: data.currentBalance.toFixed(2),
    includeInProjection: data.includeInProjection,
    displayOrder: data.displayOrder,
    notes: data.notes
  });
  req.flash("success", "Account created.");
  res.redirect("/accounts");
};

export const editAccount = async (req: Request, res: Response) => {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, req.params.id)).limit(1);
  if (!account) {
    req.flash("error", "Account not found.");
    res.redirect("/accounts");
    return;
  }
  res.render("layout", { title: "Edit Account", view: "accounts/form", account, accountTypes });
};

export const updateAccount = async (req: Request, res: Response) => {
  const parsed = accountSchema.safeParse(req.body);
  if (!parsed.success) {
    req.flash("error", firstValidationMessage(parsed.error));
    res.status(422).render("layout", {
      title: "Edit Account",
      view: "accounts/form",
      account: { ...req.body, id: req.params.id, active: true },
      accountTypes
    });
    return;
  }

  const data = parsed.data;
  await db
    .update(accounts)
    .set({
      name: data.name,
      type: data.type,
      startingBalance: data.startingBalance.toFixed(2),
      currentBalance: data.currentBalance.toFixed(2),
      includeInProjection: data.includeInProjection,
      displayOrder: data.displayOrder,
      notes: data.notes,
      updatedAt: new Date()
    })
    .where(eq(accounts.id, req.params.id));
  req.flash("success", "Account updated.");
  res.redirect("/accounts");
};

export const archiveAccount = async (req: Request, res: Response) => {
  await db.update(accounts).set({ active: false, updatedAt: new Date() }).where(eq(accounts.id, req.params.id));
  req.flash("success", "Account archived.");
  res.redirect("/accounts");
};
