import { Router } from "express";
import {
  archiveFutureCommitment,
  createCommitmentEntry,
  createFutureCommitment,
  editFutureCommitment,
  listFutureCommitments,
  newCommitmentEntry,
  newFutureCommitment,
  updateFutureCommitment
} from "../controllers/futureCommitments.controller.js";
import { requireAuth } from "../middleware/auth.js";

export const futureCommitmentsRoutes = Router();

futureCommitmentsRoutes.use(requireAuth);
futureCommitmentsRoutes.get("/", listFutureCommitments);
futureCommitmentsRoutes.get("/new", newFutureCommitment);
futureCommitmentsRoutes.post("/", createFutureCommitment);
futureCommitmentsRoutes.get("/:id/edit", editFutureCommitment);
futureCommitmentsRoutes.post("/:id", updateFutureCommitment);
futureCommitmentsRoutes.post("/:id/archive", archiveFutureCommitment);
futureCommitmentsRoutes.get("/:id/enter", newCommitmentEntry);
futureCommitmentsRoutes.post("/:id/enter", createCommitmentEntry);
