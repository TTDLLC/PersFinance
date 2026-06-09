import { Router } from "express";
import {
  archivePayee,
  createPayee,
  editPayee,
  listPayees,
  newPayee,
  updatePayee
} from "../controllers/payees.controller.js";
import { requireAuth } from "../middleware/auth.js";

export const payeesRoutes = Router();

payeesRoutes.use(requireAuth);
payeesRoutes.get("/", listPayees);
payeesRoutes.get("/new", newPayee);
payeesRoutes.post("/", createPayee);
payeesRoutes.get("/:id/edit", editPayee);
payeesRoutes.post("/:id", updatePayee);
payeesRoutes.post("/:id/archive", archivePayee);
