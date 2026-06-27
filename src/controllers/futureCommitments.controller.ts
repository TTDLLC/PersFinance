import type { Request, Response } from "express";
import { asc, desc, eq, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, categories, futureCommitments, payees } from "../db/schema.js";
import {
  enterCommitment,
  getCommitment,
  isoToday,
  listCommitments
} from "../services/futureCommitments.service.js";
import {
  commitmentEntrySchema,
  commitmentFrequencies,
  firstValidationMessage,
  futureCommitmentSchema
} from "../validation/forms.js";
import { archiveToggleHref } from "./archiveToggle.js";

const queryFlag = (value: unknown) => value === "true" || value === "on";
const queryString = (value: unknown) => (typeof value === "string" ? value : "");
const toMoney = (value: number) => value.toFixed(2);

const formData = async (commitment?: { accountId?: string | null; payeeId?: string | null; categoryId?: string | null }) => ({
  accounts: await db
    .select()
    .from(accounts)
    .where(commitment?.accountId ? or(eq(accounts.active, true), eq(accounts.id, commitment.accountId)) : eq(accounts.active, true))
    .orderBy(desc(accounts.active), asc(accounts.name)),
  payees: await db
    .select()
    .from(payees)
    .where(commitment?.payeeId ? or(eq(payees.active, true), eq(payees.id, commitment.payeeId)) : eq(payees.active, true))
    .orderBy(desc(payees.active), asc(payees.name)),
  categories: await db
    .select()
    .from(categories)
    .where(commitment?.categoryId ? or(eq(categories.active, true), eq(categories.id, commitment.categoryId)) : eq(categories.active, true))
    .orderBy(desc(categories.active), asc(categories.name)),
  frequencies: commitmentFrequencies
});

export const listFutureCommitments = async (req: Request, res: Response) => {
  const showAll = queryFlag(req.query.showAll);
  const filters = {
    payeeId: queryString(req.query.payeeId),
    accountId: queryString(req.query.accountId)
  };
  res.render("layout", {
    title: "Future Commitments",
    view: "commitments/index",
    commitments: await listCommitments(showAll, isoToday(), filters),
    showAll,
    historyToggleHref: archiveToggleHref("/commitments", req.query, showAll, { parameter: "showAll" }),
    filters,
    filterAccounts: await db
      .select()
      .from(accounts)
      .where(filters.accountId ? or(eq(accounts.active, true), eq(accounts.id, filters.accountId)) : eq(accounts.active, true))
      .orderBy(desc(accounts.active), asc(accounts.name)),
    filterPayees: await db
      .select()
      .from(payees)
      .where(filters.payeeId ? or(eq(payees.active, true), eq(payees.id, filters.payeeId)) : eq(payees.active, true))
      .orderBy(desc(payees.active), asc(payees.name)),
    today: isoToday()
  });
};

export const newFutureCommitment = async (_req: Request, res: Response) => {
  const date = isoToday();
  res.render("layout", {
    title: "New Future Commitment",
    view: "commitments/form",
    commitment: { startDate: date, nextDueDate: date, frequency: "monthly", active: true },
    ...(await formData())
  });
};

export const createFutureCommitment = async (req: Request, res: Response) => {
  const parsed = futureCommitmentSchema.safeParse(req.body);
  if (!parsed.success) {
    req.flash("error", firstValidationMessage(parsed.error));
    res.status(422).render("layout", {
      title: "New Future Commitment",
      view: "commitments/form",
      commitment: req.body,
      ...(await formData(req.body))
    });
    return;
  }
  await db.insert(futureCommitments).values({ ...parsed.data, scenarioId: null, includeInBaseline: true, amount: toMoney(parsed.data.amount) });
  req.flash("success", "Future commitment created.");
  res.redirect("/commitments");
};

export const editFutureCommitment = async (req: Request, res: Response) => {
  const commitment = await getCommitment(req.params.id, { baselineOnly: true });
  if (!commitment) {
    req.flash("error", "Future commitment not found.");
    res.redirect("/commitments");
    return;
  }
  res.render("layout", {
    title: "Edit Future Commitment",
    view: "commitments/form",
    commitment,
    ...(await formData(commitment))
  });
};

export const updateFutureCommitment = async (req: Request, res: Response) => {
  const existing = await getCommitment(req.params.id, { baselineOnly: true });
  const parsed = futureCommitmentSchema.safeParse(req.body);
  if (!existing) {
    req.flash("error", "Future commitment not found.");
    res.redirect("/commitments");
    return;
  }
  if (!parsed.success) {
    req.flash("error", firstValidationMessage(parsed.error));
    res.status(422).render("layout", {
      title: "Edit Future Commitment",
      view: "commitments/form",
      commitment: { ...req.body, id: existing.id },
      ...(await formData(existing))
    });
    return;
  }
  await db
    .update(futureCommitments)
    .set({ ...parsed.data, amount: toMoney(parsed.data.amount), updatedAt: new Date() })
    .where(eq(futureCommitments.id, existing.id));
  req.flash("success", "Future commitment updated.");
  res.redirect("/commitments");
};

export const archiveFutureCommitment = async (req: Request, res: Response) => {
  const existing = await getCommitment(req.params.id, { baselineOnly: true });
  if (!existing) {
    req.flash("error", "Future commitment not found.");
    res.redirect("/commitments");
    return;
  }
  const endedOn = existing.startDate > isoToday() ? existing.startDate : isoToday();
  await db
    .update(futureCommitments)
    .set({ active: false, endDate: existing.endDate ?? endedOn, updatedAt: new Date() })
    .where(eq(futureCommitments.id, req.params.id));
  req.flash("success", "Future commitment ended and retained in history.");
  res.redirect("/commitments");
};

export const newCommitmentEntry = async (req: Request, res: Response) => {
  const commitment = await getCommitment(req.params.id, { baselineOnly: true });
  if (!commitment) {
    req.flash("error", "Future commitment not found.");
    res.redirect("/commitments");
    return;
  }
  res.render("layout", {
    title: `Enter ${commitment.name}`,
    view: "commitments/enter",
    commitment,
    entry: {
      accountId: commitment.accountId ?? "",
      date: isoToday(),
      amount: commitment.amount,
      notes: commitment.notes ?? ""
    },
    accounts: (await formData(commitment)).accounts
  });
};

export const createCommitmentEntry = async (req: Request, res: Response) => {
  const commitment = await getCommitment(req.params.id, { baselineOnly: true });
  const parsed = commitmentEntrySchema.safeParse(req.body);
  if (!commitment) {
    req.flash("error", "Future commitment not found.");
    res.redirect("/commitments");
    return;
  }
  if (!parsed.success) {
    req.flash("error", firstValidationMessage(parsed.error));
    res.status(422).render("layout", {
      title: `Enter ${commitment.name}`,
      view: "commitments/enter",
      commitment,
      entry: req.body,
      accounts: (await formData(commitment)).accounts
    });
    return;
  }
  try {
    await enterCommitment(commitment.id, parsed.data);
    req.flash("success", "Register transaction entered and commitment advanced.");
    res.redirect(`/accounts/${parsed.data.accountId}/register`);
  } catch (error) {
    req.flash("error", error instanceof Error ? error.message : "Could not enter commitment.");
    res.redirect("/commitments");
  }
};
