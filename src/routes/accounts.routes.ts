import { Router } from "express";
import {
  archiveAccount,
  createAccount,
  editAccount,
  listAccounts,
  newAccount,
  updateAccount
} from "../controllers/accounts.controller.js";
import {
  completeAccountReconciliation,
  listAccountStatements,
  showAccountReconciliation,
  showAccountStatement
} from "../controllers/accountStatements.controller.js";
import {
  createAccountRegisterTransaction,
  editAccountRegisterTransaction,
  newAccountRegisterTransaction,
  showAccountRegister,
  updateAccountRegisterTransaction,
  voidAccountRegisterTransaction
} from "../controllers/accountRegister.controller.js";
import {
  confirmTransactionImport,
  deleteTransactionImportBatch,
  handleCsvUpload,
  previewTransactionImport,
  showTransactionImports
} from "../controllers/transactionImports.controller.js";
import { requireAuth } from "../middleware/auth.js";

export const accountsRoutes = Router();

accountsRoutes.use(requireAuth);
accountsRoutes.get("/", listAccounts);
accountsRoutes.get("/new", newAccount);
accountsRoutes.post("/", createAccount);
accountsRoutes.get("/:accountId/register", showAccountRegister);
accountsRoutes.get("/:accountId/imports", showTransactionImports);
accountsRoutes.post("/:accountId/imports/preview", handleCsvUpload, previewTransactionImport);
accountsRoutes.post("/:accountId/imports/confirm", confirmTransactionImport);
accountsRoutes.post("/:accountId/imports/:batchId/delete", deleteTransactionImportBatch);
accountsRoutes.get("/:accountId/register/new", newAccountRegisterTransaction);
accountsRoutes.post("/:accountId/register", createAccountRegisterTransaction);
accountsRoutes.get("/:accountId/register/:transactionId/edit", editAccountRegisterTransaction);
accountsRoutes.post("/:accountId/register/:transactionId", updateAccountRegisterTransaction);
accountsRoutes.post("/:accountId/register/:transactionId/void", voidAccountRegisterTransaction);
accountsRoutes.get("/:accountId/reconcile", showAccountReconciliation);
accountsRoutes.post("/:accountId/reconcile", completeAccountReconciliation);
accountsRoutes.get("/:accountId/statements", listAccountStatements);
accountsRoutes.get("/:accountId/statements/:statementId", showAccountStatement);
accountsRoutes.get("/:id/edit", editAccount);
accountsRoutes.post("/:id", updateAccount);
accountsRoutes.post("/:id/archive", archiveAccount);
