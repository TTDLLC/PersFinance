import { Router } from "express";
import { showMonthlyProjection } from "../controllers/projections.controller.js";
import { requireAuth } from "../middleware/auth.js";

export const projectionsRoutes = Router();

projectionsRoutes.use(requireAuth);
projectionsRoutes.get("/monthly", showMonthlyProjection);
