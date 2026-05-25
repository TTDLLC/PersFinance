import { Router } from "express";
import { showSettings } from "../controllers/settings.controller.js";
import { requireAuth } from "../middleware/auth.js";

export const settingsRoutes = Router();

settingsRoutes.use(requireAuth);
settingsRoutes.get("/", showSettings);
