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
  createAccountRegisterTransaction,
  editAccountRegisterTransaction,
  newAccountRegisterTransaction,
  showAccountRegister,
  updateAccountRegisterTransaction,
  voidAccountRegisterTransaction
} from "../controllers/accountRegister.controller.js";
import { requireAuth } from "../middleware/auth.js";

export const accountsRoutes = Router();

accountsRoutes.use(requireAuth);
accountsRoutes.get("/", listAccounts);
accountsRoutes.get("/new", newAccount);
accountsRoutes.post("/", createAccount);
accountsRoutes.get("/:accountId/register", showAccountRegister);
accountsRoutes.get("/:accountId/register/new", newAccountRegisterTransaction);
accountsRoutes.post("/:accountId/register", createAccountRegisterTransaction);
accountsRoutes.get("/:accountId/register/:transactionId/edit", editAccountRegisterTransaction);
accountsRoutes.post("/:accountId/register/:transactionId", updateAccountRegisterTransaction);
accountsRoutes.post("/:accountId/register/:transactionId/void", voidAccountRegisterTransaction);
accountsRoutes.get("/:id/edit", editAccount);
accountsRoutes.post("/:id", updateAccount);
accountsRoutes.post("/:id/archive", archiveAccount);
