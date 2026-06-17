import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  accounts,
  categories,
  payees,
  scenarioAdjustments
} from "../db/schema.js";
import {
  archiveScenarioController,
  createScenarioController,
  editScenarioController,
  listScenariosController,
  newScenarioController,
  updateScenarioController,
  viewScenarioController
} from "../controllers/scenarioEditor.controller.js";
import {
  createScenarioAdjustment,
  deleteScenarioAdjustment,
  getScenario,
  listScenarioAdjustments,
  updateScenarioAdjustment
} from "../services/scenarios.service.js";

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
      accounts: await activeAccounts(),
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
    next(error);
  }
});

scenariosRoutes.get("/:id/adjustments/:adjustmentId/edit", async (req, res, next) => {
  try {
    const [adjustment] = await db
      .select()
      .from(scenarioAdjustments)
      .where(eq(scenarioAdjustments.id, req.params.adjustmentId))
      .limit(1);
    if (!adjustment || adjustment.scenarioId !== req.params.id) {
      req.flash("error", "Adjustment not found.");
      res.redirect(`/scenarios/${req.params.id}`);
      return;
    }
    res.render("layout", {
      title: "Edit Adjustment",
      view: "scenarios/adjustment-form",
      scenario: await getScenario(req.params.id),
      adjustment,
      accounts: await activeAccounts(),
      payees: await activePayees(),
      categories: await activeCategories()
    });
  } catch (error) {
    next(error);
  }
});

scenariosRoutes.post("/:id/adjustments/:adjustmentId", async (req, res, next) => {
  try {
    await updateScenarioAdjustment(req.params.adjustmentId, {
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
    next(error);
  }
});

scenariosRoutes.post(
  "/:id/adjustments/:adjustmentId/delete",
  async (req, res, next) => {
    try {
      const [existing] = await db
        .select()
        .from(scenarioAdjustments)
        .where(eq(scenarioAdjustments.id, req.params.adjustmentId))
        .limit(1);
      if (!existing || existing.scenarioId !== req.params.id) {
        req.flash("error", "Adjustment not found.");
        res.redirect(`/scenarios/${req.params.id}`);
        return;
      }
      await deleteScenarioAdjustment(req.params.adjustmentId);
      req.flash("success", "Adjustment removed.");
      res.redirect(`/scenarios/${req.params.id}`);
    } catch (error) {
      next(error);
    }
  }
);
