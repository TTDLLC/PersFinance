import type { Request, Response } from "express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { accountBalanceSnapshots, accounts, transactions } from "../db/schema.js";
import { accountSchema, accountTypes, firstValidationMessage } from "../validation/forms.js";

const activeUnreconciledStatuses: Array<"entered" | "pending" | "cleared" | "recurring"> = [
  "entered",
  "pending",
  "cleared",
  "recurring"
];
const toNumber = (value: string | number | null | undefined) => Number(value ?? 0);

const accountActivityCounts = async (accountId: string) => {
  const [transactionCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(eq(transactions.accountId, accountId));
  const [snapshotCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accountBalanceSnapshots)
    .where(eq(accountBalanceSnapshots.accountId, accountId));
  const [activeUnreconciledCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), inArray(transactions.status, activeUnreconciledStatuses)));

  return {
    transactionCount: transactionCount?.count ?? 0,
    snapshotCount: snapshotCount?.count ?? 0,
    activeUnreconciledCount: activeUnreconciledCount?.count ?? 0
  };
};

const accountBalanceLocked = async (accountId: string) => {
  const counts = await accountActivityCounts(accountId);
  return counts.transactionCount > 0 || counts.snapshotCount > 0;
};

export const listAccounts = async (_req: Request, res: Response) => {
  const rows = await db.select().from(accounts).orderBy(asc(accounts.displayOrder), asc(accounts.name));
  res.render("layout", { title: "Accounts", view: "accounts/index", accounts: rows });
};

export const newAccount = (_req: Request, res: Response) => {
  res.render("layout", { title: "New Account", view: "accounts/form", account: {}, accountTypes, balanceLocked: false, activityCounts: null });
};

export const createAccount = async (req: Request, res: Response) => {
  const parsed = accountSchema.safeParse(req.body);
  if (!parsed.success) {
    req.flash("error", firstValidationMessage(parsed.error));
    res.status(422).render("layout", { title: "New Account", view: "accounts/form", account: req.body, accountTypes, balanceLocked: false, activityCounts: null });
    return;
  }

  const data = parsed.data;
  await db.insert(accounts).values({
    name: data.name,
    type: data.type,
    startingBalance: data.startingBalance.toFixed(2),
    currentBalance: data.currentBalance.toFixed(2),
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
  const activityCounts = await accountActivityCounts(account.id);
  res.render("layout", {
    title: "Edit Account",
    view: "accounts/form",
    account,
    accountTypes,
    balanceLocked: activityCounts.transactionCount > 0 || activityCounts.snapshotCount > 0,
    activityCounts
  });
};

export const updateAccount = async (req: Request, res: Response) => {
  const [existing] = await db.select().from(accounts).where(eq(accounts.id, req.params.id)).limit(1);
  if (!existing) {
    req.flash("error", "Account not found.");
    res.redirect("/accounts");
    return;
  }

  const activityCounts = await accountActivityCounts(existing.id);
  const balanceLocked = activityCounts.transactionCount > 0 || activityCounts.snapshotCount > 0;
  const parsed = accountSchema.safeParse(req.body);
  if (!parsed.success) {
    req.flash("error", firstValidationMessage(parsed.error));
    res.status(422).render("layout", {
      title: "Edit Account",
      view: "accounts/form",
      account: { ...req.body, id: req.params.id, active: true },
      accountTypes,
      balanceLocked,
      activityCounts
    });
    return;
  }

  const data = parsed.data;
  if (
    balanceLocked &&
    (toNumber(existing.startingBalance) !== data.startingBalance || toNumber(existing.currentBalance) !== data.currentBalance)
  ) {
    req.flash("error", "Account balances are locked after register activity or snapshots exist. Use register activity or reconciliation snapshots instead.");
    res.status(422).render("layout", {
      title: "Edit Account",
      view: "accounts/form",
      account: existing,
      accountTypes,
      balanceLocked,
      activityCounts
    });
    return;
  }

  await db
    .update(accounts)
    .set({
      name: data.name,
      type: data.type,
      startingBalance: data.startingBalance.toFixed(2),
      currentBalance: data.currentBalance.toFixed(2),
      displayOrder: data.displayOrder,
      notes: data.notes,
      updatedAt: new Date()
    })
    .where(eq(accounts.id, req.params.id));
  req.flash("success", "Account updated.");
  res.redirect("/accounts");
};

export const archiveAccount = async (req: Request, res: Response) => {
  const activityCounts = await accountActivityCounts(req.params.id);
  if (activityCounts.activeUnreconciledCount > 0) {
    req.flash("error", `Account has ${activityCounts.activeUnreconciledCount} active unreconciled transaction(s). Reconcile, void, or move them before archiving.`);
    res.redirect("/accounts");
    return;
  }

  await db.update(accounts).set({ active: false, updatedAt: new Date() }).where(eq(accounts.id, req.params.id));
  req.flash("success", "Account archived.");
  res.redirect("/accounts");
};
