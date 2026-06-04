import { Router } from "express";
import { showProjections } from "../controllers/projections.controller.js";
import { requireAuth } from "../middleware/auth.js";

export const projectionsRoutes = Router();

projectionsRoutes.use(requireAuth);
projectionsRoutes.get("/", showProjections);
