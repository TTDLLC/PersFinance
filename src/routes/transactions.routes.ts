import { Router } from "express";
import {
  createTransaction,
  editTransaction,
  listTransactions,
  newTransaction,
  updateTransaction,
  voidTransaction
} from "../controllers/transactions.controller.js";
import { requireAuth } from "../middleware/auth.js";

export const transactionsRoutes = Router();

transactionsRoutes.use(requireAuth);
transactionsRoutes.get("/", listTransactions);
transactionsRoutes.get("/new", newTransaction);
transactionsRoutes.post("/", createTransaction);
transactionsRoutes.get("/:id/edit", editTransaction);
transactionsRoutes.post("/:id", updateTransaction);
transactionsRoutes.post("/:id/void", voidTransaction);
