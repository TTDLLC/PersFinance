import { Router } from "express";
import {
  createScenario,
  editScenario,
  listScenarios,
  newScenario,
  updateScenario
} from "../controllers/scenarios.controller.js";
import { requireAuth } from "../middleware/auth.js";

export const scenariosRoutes = Router();

scenariosRoutes.use(requireAuth);
scenariosRoutes.get("/", listScenarios);
scenariosRoutes.get("/new", newScenario);
scenariosRoutes.post("/", createScenario);
scenariosRoutes.get("/:id/edit", editScenario);
scenariosRoutes.post("/:id", updateScenario);
