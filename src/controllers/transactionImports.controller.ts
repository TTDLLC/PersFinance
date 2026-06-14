import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { Accounts } from "../services/accounts.service.js";
import {
  buildImportPreview,
  confirmImportPreview,
  ImportConfirmationError,
  listImportBatches,
  rollbackImportBatch
} from "../services/transactionImport.service.js";

export const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

const importPath = (accountId: string) => `/accounts/${accountId}/imports`;
const uploadCsvFile = csvUpload.single("csvFile");

export const handleCsvUpload = (req: Request, res: Response, next: NextFunction) => {
  uploadCsvFile(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    req.flash("error", error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
      ? "CSV file must be 5 MB or smaller."
      : "Could not upload the CSV file.");
    res.redirect(importPath(req.params.accountId));
  });
};

const selectedIdsFromForm = (value: unknown) => {
  if (value === undefined || value === "") return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
};

const logImportFailure = (
  account: { id: string; data: { name: string } },
  filename: string | null,
  rowCount: number,
  phase: string,
  error: unknown
) => {
  console.error("Transaction import failed", {
    accountId: account.id,
    accountName: account.data.name,
    filename,
    rowCount,
    phase,
    error: error instanceof Error ? error.message : String(error)
  });
};

export const showTransactionImports = async (req: Request, res: Response) => {
  const account = await Accounts.getAccount(req.params.accountId);
  if (!account) {
    req.flash("error", "Account not found.");
    res.redirect("/accounts");
    return;
  }

  res.render("layout", {
    title: `${account.data.name} CSV Imports`,
    view: "accounts/imports",
    account: account.data,
    batches: await listImportBatches(account.id)
  });
};

export const previewTransactionImport = async (req: Request, res: Response) => {
  const account = await Accounts.getAccount(req.params.accountId);
  if (!account) {
    req.flash("error", "Account not found.");
    res.redirect("/accounts");
    return;
  }

  if (!req.file) {
    req.flash("error", "Choose a CSV file to import.");
    res.redirect(importPath(account.id));
    return;
  }

  if (!req.file.originalname.toLocaleLowerCase().endsWith(".csv")) {
    req.flash("error", "Only .csv files are supported.");
    res.redirect(importPath(account.id));
    return;
  }

  try {
    const preview = await buildImportPreview(account.id, req.file.buffer.toString("utf8"), req.file.originalname);
    req.session.transactionImportPreview = preview;
    res.render("layout", {
      title: `Preview ${account.data.name} Import`,
      view: "accounts/import-preview",
      account: account.data,
      preview
    });
  } catch (error) {
    const estimatedRowCount = Math.max(0, req.file.buffer.toString("utf8").split(/\r?\n/).filter(Boolean).length - 1);
    logImportFailure(account, req.file.originalname, estimatedRowCount, "preview", error);
    req.flash("error", error instanceof Error ? error.message : "Could not read the CSV file.");
    res.redirect(importPath(account.id));
  }
};

export const confirmTransactionImport = async (req: Request, res: Response) => {
  const account = await Accounts.getAccount(req.params.accountId);
  const preview = req.session.transactionImportPreview;
  if (!account || !preview || preview.accountId !== req.params.accountId) {
    req.flash("error", !account ? "Account not found." : "Import preview expired. Upload the CSV again.");
    res.redirect(account ? importPath(account.id) : "/accounts");
    return;
  }

  try {
    const batch = await confirmImportPreview(preview, selectedIdsFromForm(req.body.includedDuplicateIds));
    delete req.session.transactionImportPreview;
    req.flash("success", `Imported ${batch.importedRows} transaction${batch.importedRows === 1 ? "" : "s"}.`);
    res.redirect(`/accounts/${account.id}/register`);
  } catch (error) {
    logImportFailure(
      account,
      preview.filename,
      preview.totalRows,
      error instanceof ImportConfirmationError ? error.phase : "confirmation",
      error
    );
    req.flash("error", "The import could not be completed. No transactions were added. Please review the file and try again.");
    res.redirect(importPath(account.id));
  }
};

export const deleteTransactionImportBatch = async (req: Request, res: Response) => {
  try {
    await rollbackImportBatch(req.params.accountId, req.params.batchId);
    req.flash("success", "Import batch and its eligible transactions were deleted.");
  } catch (error) {
    req.flash("error", error instanceof Error ? error.message : "Import batch could not be deleted.");
  }
  res.redirect(importPath(req.params.accountId));
};
