import { Router } from "express";
import {
  archiveRecurring,
  createRecurring,
  editRecurring,
  listRecurring,
  newRecurring,
  updateRecurring
} from "../controllers/recurring.controller.js";
import { requireAuth } from "../middleware/auth.js";

export const recurringRoutes = Router();

recurringRoutes.use(requireAuth);
recurringRoutes.get("/", listRecurring);
recurringRoutes.get("/new", newRecurring);
recurringRoutes.post("/", createRecurring);
recurringRoutes.get("/:id/edit", editRecurring);
recurringRoutes.post("/:id", updateRecurring);
recurringRoutes.post("/:id/archive", archiveRecurring);
