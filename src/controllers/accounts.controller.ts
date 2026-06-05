import type { Request, Response } from "express";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts } from "../db/schema.js";
import { Accounts } from "../services/accounts.service.js";
import { accountSchema, accountTypes, firstValidationMessage } from "../validation/forms.js";

const today = () => new Date().toISOString().slice(0, 10);
const toMoney = (value: number) => value.toFixed(2);

export const listAccounts = async (_req: Request, res: Response) => {
  const rows = await Accounts.list({ activeOnly: false });
  res.render("layout", { title: "Accounts", view: "accounts/index", accounts: rows });
};

export const newAccount = (_req: Request, res: Response) => {
  res.render("layout", {
    title: "New Account",
    view: "accounts/form",
    account: { startingInformationDate: today() },
    accountTypes,
    startingInformationState: { editable: true, warning: false, transactionCount: 0, statementCount: 0 }
  });
};

export const createAccount = async (req: Request, res: Response) => {
  const parsed = accountSchema.safeParse(req.body);
  if (!parsed.success) {
    req.flash("error", firstValidationMessage(parsed.error));
    res.status(422).render("layout", {
      title: "New Account",
      view: "accounts/form",
      account: req.body,
      accountTypes,
      startingInformationState: { editable: true, warning: false, transactionCount: 0, statementCount: 0 }
    });
    return;
  }

  const data = parsed.data;
  await Accounts.createAccount({
    name: data.name,
    type: data.type,
    startingInformation: {
      balance: toMoney(data.startingInformationBalance),
      date: data.startingInformationDate,
      notes: data.startingInformationNotes
    },
    displayOrder: data.displayOrder,
    notes: data.notes
  });
  req.flash("success", "Account created.");
  res.redirect("/accounts");
};

export const editAccount = async (req: Request, res: Response) => {
  const account = await Accounts.getAccount(req.params.id);
  if (!account) {
    req.flash("error", "Account not found.");
    res.redirect("/accounts");
    return;
  }

  res.render("layout", {
    title: "Edit Account",
    view: "accounts/form",
    account: account.data,
    accountTypes,
    startingInformationState: await account.canEditStartingInformation()
  });
};

export const updateAccount = async (req: Request, res: Response) => {
  const account = await Accounts.getAccount(req.params.id);
  if (!account) {
    req.flash("error", "Account not found.");
    res.redirect("/accounts");
    return;
  }

  const startingInformationState = await account.canEditStartingInformation();
  const parsed = accountSchema.safeParse(req.body);
  if (!parsed.success) {
    req.flash("error", firstValidationMessage(parsed.error));
    res.status(422).render("layout", {
      title: "Edit Account",
      view: "accounts/form",
      account: { ...req.body, id: req.params.id, active: true },
      accountTypes,
      startingInformationState
    });
    return;
  }

  const data = parsed.data;
  const updateValues: Partial<typeof accounts.$inferInsert> = {
    name: data.name,
    type: data.type,
    displayOrder: data.displayOrder,
    notes: data.notes,
    updatedAt: new Date()
  };

  if (startingInformationState.editable) {
    updateValues.startingInformationBalance = toMoney(data.startingInformationBalance);
    updateValues.startingInformationDate = data.startingInformationDate;
    updateValues.startingInformationNotes = data.startingInformationNotes;
    updateValues.statementChainBalance = toMoney(data.startingInformationBalance);
  }

  await db.update(accounts).set(updateValues).where(eq(accounts.id, req.params.id));
  req.flash("success", "Account updated.");
  res.redirect("/accounts");
};

export const archiveAccount = async (req: Request, res: Response) => {
  await db.update(accounts).set({ active: false, updatedAt: new Date() }).where(eq(accounts.id, req.params.id));
  req.flash("success", "Account archived.");
  res.redirect("/accounts");
};
