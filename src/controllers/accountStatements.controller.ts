import type { Request, Response } from "express";
import { Accounts } from "../services/accounts.service.js";
import { firstValidationMessage, reconciliationSchema } from "../validation/forms.js";

const today = () => new Date().toISOString().slice(0, 10);

const selectedIdsFromForm = (value: unknown) => {
  if (value === undefined || value === "") return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
};

const previewFor = async (
  accountId: string,
  values: { statementDate?: string; endingBalance?: string | number; selectedTransactionIds?: string[]; notes?: string | null }
) => {
  const account = await Accounts.getAccount(accountId);
  if (!account) return null;
  return {
    account: account.data,
    preview: await account.previewReconciliation({
      statementDate: values.statementDate || today(),
      endingBalance: Number(values.endingBalance ?? account.getStatementBalance()),
      selectedTransactionIds: values.selectedTransactionIds ?? [],
      notes: values.notes
    })
  };
};

export const showAccountReconciliation = async (req: Request, res: Response) => {
  const data = await previewFor(req.params.accountId, {
    statementDate: typeof req.query.statementDate === "string" ? req.query.statementDate : today(),
    endingBalance: typeof req.query.endingBalance === "string" ? req.query.endingBalance : undefined
  });

  if (!data) {
    req.flash("error", "Account not found.");
    res.redirect("/accounts");
    return;
  }

  res.render("layout", {
    title: `${data.account.name} Reconciliation`,
    view: "accounts/reconcile",
    reconciliation: data
  });
};

export const completeAccountReconciliation = async (req: Request, res: Response) => {
  const account = await Accounts.getAccount(req.params.accountId);
  if (!account) {
    req.flash("error", "Account not found.");
    res.redirect("/accounts");
    return;
  }

  const parsed = reconciliationSchema.safeParse(req.body);
  if (!parsed.success) {
    req.flash("error", firstValidationMessage(parsed.error));
    const data = await previewFor(account.id, {
      statementDate: req.body.statementDate,
      endingBalance: req.body.endingBalance,
      selectedTransactionIds: selectedIdsFromForm(req.body.selectedTransactionIds),
      notes: req.body.notes
    });
    res.status(422).render("layout", {
      title: `${account.data.name} Reconciliation`,
      view: "accounts/reconcile",
      reconciliation: data
    });
    return;
  }

  try {
    const result = await account.reconcileStatement(parsed.data);
    req.flash("success", "Statement reconciled.");
    res.redirect(`/accounts/${account.id}/statements/${result.statementId}`);
  } catch (error) {
    req.flash("error", error instanceof Error ? error.message : "Reconciliation failed.");
    const data = await previewFor(account.id, parsed.data);
    res.status(422).render("layout", {
      title: `${account.data.name} Reconciliation`,
      view: "accounts/reconcile",
      reconciliation: data
    });
  }
};

export const listAccountStatements = async (req: Request, res: Response) => {
  const account = await Accounts.getAccount(req.params.accountId);
  if (!account) {
    req.flash("error", "Account not found.");
    res.redirect("/accounts");
    return;
  }

  res.render("layout", {
    title: `${account.data.name} Statements`,
    view: "accounts/statements",
    account: account.data,
    statements: await account.getStatements()
  });
};

export const showAccountStatement = async (req: Request, res: Response) => {
  const account = await Accounts.getAccount(req.params.accountId);
  if (!account) {
    req.flash("error", "Account not found.");
    res.redirect("/accounts");
    return;
  }

  const statement = await account.getStatement(req.params.statementId);
  if (!statement) {
    req.flash("error", "Statement not found.");
    res.redirect(`/accounts/${account.id}/statements`);
    return;
  }

  res.render("layout", {
    title: `${account.data.name} Statement`,
    view: "accounts/statement-detail",
    account: account.data,
    statement,
    transactions: await account.getStatementTransactions(statement.id)
  });
};
