import type { Request, Response } from "express";
import { asc, eq, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts } from "../db/schema.js";
import { createTransfer, deleteTransfer, getTransfer, updateTransfer } from "../services/transfers.service.js";
import { firstValidationMessage, transferSchema } from "../validation/forms.js";

const today = () => new Date().toISOString().slice(0, 10);
const registerUrl = (accountId: string) => `/accounts/${accountId}/register`;

const formAccounts = async (currentIds: string[] = []) =>
  db
    .select()
    .from(accounts)
    .where(currentIds.length ? or(eq(accounts.active, true), ...currentIds.map((id) => eq(accounts.id, id))) : eq(accounts.active, true))
    .orderBy(asc(accounts.name));

const renderForm = async (
  res: Response,
  accountId: string,
  transfer: Record<string, unknown>,
  status = 200,
  locked = false
) =>
  res.status(status).render("layout", {
    title: transfer.id ? "Edit Transfer" : "New Transfer",
    view: "accounts/transfer-form",
    accountId,
    transfer,
    locked,
    accounts: await formAccounts(
      [transfer.sourceAccountId, transfer.destinationAccountId].filter(
        (id): id is string => typeof id === "string" && id.length > 0
      )
    )
  });

export const newTransfer = async (req: Request, res: Response) => {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, req.params.accountId)).limit(1);
  if (!account) {
    req.flash("error", "Account not found.");
    res.redirect("/accounts");
    return;
  }
  await renderForm(res, account.id, {
    date: today(),
    amount: "",
    sourceAccountId: account.id,
    destinationAccountId: "",
    status: "entered"
  });
};

export const createAccountTransfer = async (req: Request, res: Response) => {
  const parsed = transferSchema.safeParse(req.body);
  if (!parsed.success) {
    req.flash("error", firstValidationMessage(parsed.error));
    await renderForm(res, req.params.accountId, req.body, 422);
    return;
  }
  try {
    await createTransfer(parsed.data);
    req.flash("success", "Transfer created.");
    res.redirect(registerUrl(req.params.accountId));
  } catch (error) {
    req.flash("error", error instanceof Error ? error.message : "Could not create transfer.");
    await renderForm(res, req.params.accountId, req.body, 422);
  }
};

export const editTransfer = async (req: Request, res: Response) => {
  const transfer = await getTransfer(req.params.transferId);
  if (!transfer) {
    req.flash("error", "Transfer not found.");
    res.redirect(registerUrl(req.params.accountId));
    return;
  }
  await renderForm(
    res,
    req.params.accountId,
    {
      id: transfer.id,
      date: transfer.source.date,
      amount: Number(transfer.source.amount).toFixed(2),
      sourceAccountId: transfer.source.accountId,
      destinationAccountId: transfer.destination.accountId,
      status: transfer.source.status,
      notes: transfer.source.notes
    },
    200,
    transfer.locked
  );
};

export const updateAccountTransfer = async (req: Request, res: Response) => {
  const parsed = transferSchema.safeParse(req.body);
  if (!parsed.success) {
    req.flash("error", firstValidationMessage(parsed.error));
    await renderForm(res, req.params.accountId, { ...req.body, id: req.params.transferId }, 422);
    return;
  }
  try {
    await updateTransfer(req.params.transferId, parsed.data);
    req.flash("success", "Transfer updated.");
    res.redirect(registerUrl(req.params.accountId));
  } catch (error) {
    req.flash("error", error instanceof Error ? error.message : "Could not update transfer.");
    res.redirect(registerUrl(req.params.accountId));
  }
};

export const destroyTransfer = async (req: Request, res: Response) => {
  try {
    await deleteTransfer(req.params.transferId);
    req.flash("success", "Transfer deleted.");
  } catch (error) {
    req.flash("error", error instanceof Error ? error.message : "Could not delete transfer.");
  }
  res.redirect(registerUrl(req.params.accountId));
};
