import { Router } from "express";
import {
  createFutureTransaction,
  deleteFutureTransaction,
  editFutureTransaction,
  listFutureTransactions,
  newFutureTransaction,
  updateFutureTransaction
} from "../controllers/futureTransactions.controller.js";
import { requireAuth } from "../middleware/auth.js";

export const futureTransactionsRoutes = Router();

futureTransactionsRoutes.use(requireAuth);
futureTransactionsRoutes.get("/", listFutureTransactions);
futureTransactionsRoutes.get("/new", newFutureTransaction);
futureTransactionsRoutes.post("/", createFutureTransaction);
futureTransactionsRoutes.get("/:id/edit", editFutureTransaction);
futureTransactionsRoutes.post("/:id", updateFutureTransaction);
futureTransactionsRoutes.post("/:id/delete", deleteFutureTransaction);
