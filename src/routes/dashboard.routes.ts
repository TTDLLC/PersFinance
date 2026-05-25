import { Router } from "express";
import { showDashboard } from "../controllers/dashboard.controller.js";
import { requireAuth } from "../middleware/auth.js";

export const dashboardRoutes = Router();

dashboardRoutes.get("/", requireAuth, showDashboard);
dashboardRoutes.get("/dashboard", requireAuth, showDashboard);
