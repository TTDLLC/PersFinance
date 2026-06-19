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
  getScenario,
  getScenarioAccountOptions,
} from "../services/scenarios.service.js";
import {
  archiveScenarioCommitment,
  createScenarioCommitment,
  getScenarioCommitment,
  listScenarioCommitments,
  promoteScenarioCommitment,
  updateScenarioCommitment
} from "../services/futureCommitments.service.js";
import { commitmentFrequencies, firstValidationMessage, futureCommitmentSchema } from "../validation/forms.js";

const flashValidationError = (req: Request, error: unknown) => {
  req.flash("error", error instanceof Error ? error.message : "Could not save scenario item.");
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

const itemFormData = async () => ({
  accounts: await activeAccounts(),
  payees: await activePayees(),
  categories: await activeCategories(),
  frequencies: commitmentFrequencies
});

const parseScenarioItem = (body: unknown) => {
  const parsed = futureCommitmentSchema.safeParse(body);
  if (!parsed.success) throw new Error(firstValidationMessage(parsed.error));
  if (!parsed.data.accountId) throw new Error("Scenario item account is required.");
  return parsed.data;
};

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
      items: await listScenarioCommitments(scenario.id)
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
      items: await listScenarioCommitments(scenario.id)
    });
  } catch (error) {
    next(error);
  }
});

scenariosRoutes.post("/:id", updateScenarioController);
scenariosRoutes.post("/:id/archive", archiveScenarioController);

scenariosRoutes.get("/:id/items/new", async (req, res, next) => {
  try {
    const scenario = await getScenario(req.params.id);
    if (!scenario) {
      req.flash("error", "Scenario not found.");
      res.redirect("/scenarios");
      return;
    }
    res.render("layout", {
      title: "Add Scenario Item",
      view: "scenarios/item-form",
      scenario,
      item: {
        startDate: new Date().toISOString().slice(0, 10),
        nextDueDate: new Date().toISOString().slice(0, 10),
        frequency: "monthly",
        active: true
      },
      ...(await itemFormData())
    });
  } catch (error) {
    next(error);
  }
});

scenariosRoutes.post("/:id/items", async (req, res, next) => {
  try {
    const data = parseScenarioItem(req.body);
    await createScenarioCommitment({
      scenarioId: req.params.id,
      ...data
    });
    req.flash("success", "Scenario item added.");
    res.redirect(`/scenarios/${req.params.id}`);
  } catch (error) {
    flashValidationError(req, error);
    res.redirect(`/scenarios/${req.params.id}/items/new`);
  }
});

scenariosRoutes.get("/:id/items/:itemId/edit", async (req, res, next) => {
  try {
    const scenario = await getScenario(req.params.id);
    const item = await getScenarioCommitment(req.params.id, req.params.itemId);
    if (!scenario || !item) {
      req.flash("error", "Scenario item not found.");
      res.redirect(`/scenarios/${req.params.id}`);
      return;
    }
    res.render("layout", {
      title: "Edit Scenario Item",
      view: "scenarios/item-form",
      scenario,
      item,
      ...(await itemFormData())
    });
  } catch (error) {
    next(error);
  }
});

scenariosRoutes.post("/:id/items/:itemId", async (req, res, next) => {
  try {
    const data = parseScenarioItem(req.body);
    await updateScenarioCommitment(req.params.id, req.params.itemId, data);
    req.flash("success", "Scenario item updated.");
    res.redirect(`/scenarios/${req.params.id}`);
  } catch (error) {
    flashValidationError(req, error);
    res.redirect(`/scenarios/${req.params.id}/items/${req.params.itemId}/edit`);
  }
});

scenariosRoutes.post(
  "/:id/items/:itemId/archive",
  async (req, res, next) => {
    try {
      const existing = await getScenarioCommitment(req.params.id, req.params.itemId);
      if (!existing) {
        req.flash("error", "Scenario item not found.");
        res.redirect(`/scenarios/${req.params.id}`);
        return;
      }
      await archiveScenarioCommitment(req.params.id, req.params.itemId);
      req.flash("success", "Scenario item archived.");
      res.redirect(`/scenarios/${req.params.id}`);
    } catch (error) {
      next(error);
    }
  }
);

scenariosRoutes.post("/:id/items/:itemId/promote", async (req, res, next) => {
  try {
    const [promoted] = await promoteScenarioCommitment(req.params.id, req.params.itemId);
    if (!promoted) {
      req.flash("error", "Scenario item could not be promoted.");
    } else {
      req.flash("success", "Scenario item included in baseline.");
    }
    res.redirect(`/scenarios/${req.params.id}`);
  } catch (error) {
    next(error);
  }
});
