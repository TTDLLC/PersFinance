import { Router } from "express";
import type { Request } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  accounts,
  categories,
  payees
} from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import {
  archiveScenarioController,
  createScenarioController,
  listScenariosController,
  newScenarioController,
  updateScenarioController
} from "../controllers/scenarioEditor.controller.js";
import {
  createScenarioAdjustment,
  deleteScenarioAdjustment,
  getScenario,
  getScenarioAdjustment,
  getScenarioAccountOptions,
  listScenarioAdjustments,
  updateScenarioAdjustment
} from "../services/scenarios.service.js";

const flashValidationError = (req: Request, error: unknown) => {
  req.flash("error", error instanceof Error ? error.message : "Could not save adjustment.");
};

const activeAccounts = async () =>
  db
    .select()
    .from(accounts)
    .where(eq(accounts.active, true))
    .orderBy(accounts.name);

const activePayees = async () =>
  db
    .select()
    .from(payees)
    .where(eq(payees.active, true))
    .orderBy(payees.name);

const activeCategories = async () =>
  db
    .select()
    .from(categories)
    .where(eq(categories.active, true))
    .orderBy(categories.name);

export const scenariosRoutes = Router();

scenariosRoutes.use(requireAuth);
scenariosRoutes.get("/", listScenariosController);
scenariosRoutes.get("/new", newScenarioController);
scenariosRoutes.post("/", createScenarioController);

scenariosRoutes.get("/:id", async (req, res, next) => {
  try {
    const scenario = await getScenario(req.params.id);
    if (!scenario) {
      req.flash("error", "Scenario not found.");
      res.redirect("/scenarios");
      return;
    }
    res.render("layout", {
      title: scenario.name,
      view: "scenarios/detail",
      scenario,
      accounts: await getScenarioAccountOptions(scenario.id),
      adjustments: await listScenarioAdjustments(scenario.id)
    });
  } catch (error) {
    next(error);
  }
});

scenariosRoutes.get("/:id/edit", async (req, res, next) => {
  try {
    const scenario = await getScenario(req.params.id);
    if (!scenario) {
      req.flash("error", "Scenario not found.");
      res.redirect("/scenarios");
      return;
    }
    res.render("layout", {
      title: "Edit Scenario",
      view: "scenarios/form",
      scenario,
      accounts: await activeAccounts(),
      adjustments: await listScenarioAdjustments(scenario.id)
    });
  } catch (error) {
    next(error);
  }
});

scenariosRoutes.post("/:id", updateScenarioController);
scenariosRoutes.post("/:id/archive", archiveScenarioController);

scenariosRoutes.get("/:id/adjustments/new", async (req, res, next) => {
  try {
    const scenario = await getScenario(req.params.id);
    if (!scenario) {
      req.flash("error", "Scenario not found.");
      res.redirect("/scenarios");
      return;
    }
    res.render("layout", {
      title: "New Adjustment",
      view: "scenarios/adjustment-form",
      scenario,
      adjustment: { date: new Date().toISOString().slice(0, 10), amount: "", description: "", notes: "" },
      accounts: await getScenarioAccountOptions(scenario.id),
      payees: await activePayees(),
      categories: await activeCategories()
    });
  } catch (error) {
    next(error);
  }
});

scenariosRoutes.post("/:id/adjustments", async (req, res, next) => {
  try {
    await createScenarioAdjustment({
      scenarioId: req.params.id,
      accountId: req.body.accountId,
      date: req.body.date,
      amount: req.body.amount,
      payeeId: req.body.payeeId || null,
      categoryId: req.body.categoryId || null,
      description: req.body.description || null,
      notes: req.body.notes || null
    });
    req.flash("success", "Adjustment added.");
    res.redirect(`/scenarios/${req.params.id}`);
  } catch (error) {
    flashValidationError(req, error);
    res.redirect(`/scenarios/${req.params.id}/adjustments/new`);
  }
});

scenariosRoutes.get("/:id/adjustments/:adjustmentId/edit", async (req, res, next) => {
  try {
    const scenario = await getScenario(req.params.id);
    const adjustment = await getScenarioAdjustment(req.params.id, req.params.adjustmentId);
    if (!scenario || !adjustment) {
      req.flash("error", "Adjustment not found.");
      res.redirect(`/scenarios/${req.params.id}`);
      return;
    }
    res.render("layout", {
      title: "Edit Adjustment",
      view: "scenarios/adjustment-form",
      scenario,
      adjustment,
      accounts: await getScenarioAccountOptions(req.params.id),
      payees: await activePayees(),
      categories: await activeCategories()
    });
  } catch (error) {
    next(error);
  }
});

scenariosRoutes.post("/:id/adjustments/:adjustmentId", async (req, res, next) => {
  try {
    await updateScenarioAdjustment(req.params.id, req.params.adjustmentId, {
      accountId: req.body.accountId,
      date: req.body.date,
      amount: req.body.amount,
      payeeId: req.body.payeeId || null,
      categoryId: req.body.categoryId || null,
      description: req.body.description || null,
      notes: req.body.notes || null
    });
    req.flash("success", "Adjustment updated.");
    res.redirect(`/scenarios/${req.params.id}`);
  } catch (error) {
    flashValidationError(req, error);
    res.redirect(`/scenarios/${req.params.id}/adjustments/${req.params.adjustmentId}/edit`);
  }
});

scenariosRoutes.post(
  "/:id/adjustments/:adjustmentId/delete",
  async (req, res, next) => {
    try {
      const existing = await getScenarioAdjustment(req.params.id, req.params.adjustmentId);
      if (!existing) {
        req.flash("error", "Adjustment not found.");
        res.redirect(`/scenarios/${req.params.id}`);
        return;
      }
      await deleteScenarioAdjustment(req.params.id, req.params.adjustmentId);
      req.flash("success", "Adjustment removed.");
      res.redirect(`/scenarios/${req.params.id}`);
    } catch (error) {
      next(error);
    }
  }
);
