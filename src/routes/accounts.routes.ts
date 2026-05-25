import { Router } from "express";
import {
  archiveAccount,
  createAccount,
  editAccount,
  listAccounts,
  newAccount,
  updateAccount
} from "../controllers/accounts.controller.js";
import { requireAuth } from "../middleware/auth.js";

export const accountsRoutes = Router();

accountsRoutes.use(requireAuth);
accountsRoutes.get("/", listAccounts);
accountsRoutes.get("/new", newAccount);
accountsRoutes.post("/", createAccount);
accountsRoutes.get("/:id/edit", editAccount);
accountsRoutes.post("/:id", updateAccount);
accountsRoutes.post("/:id/archive", archiveAccount);
