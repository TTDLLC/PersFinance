import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts } from "../db/schema.js";
import {
  archiveScenario,
  createScenario,
  getScenario,
  listScenarioAdjustments,
  listScenarios,
  updateScenario
} from "../services/scenarios.service.js";

export const createScenarioController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await createScenario({
      name: req.body.name ?? "",
      description: req.body.description ?? null,
      notes: req.body.notes ?? null,
      active: req.body.active === "on",
      accountIds: Array.isArray(req.body.accountIds) ? req.body.accountIds : []
    });
    req.flash("success", "Scenario created.");
    res.redirect(`/scenarios/${result.id}`);
  } catch (error) {
    next(error);
  }
};

export const updateScenarioController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await updateScenario(req.params.id, {
      name: req.body.name ?? "",
      description: req.body.description ?? null,
      notes: req.body.notes ?? null,
      active: req.body.active === "on",
      accountIds: Array.isArray(req.body.accountIds) ? req.body.accountIds : []
    });
    req.flash("success", "Scenario updated.");
    res.redirect(`/scenarios/${result.id}`);
  } catch (error) {
    next(error);
  }
};

export const archiveScenarioController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await archiveScenario(req.params.id);
    req.flash("success", "Scenario archived.");
  } catch (error) {
    req.flash("error", "Could not archive scenario.");
  }
  res.redirect("/scenarios");
};

export const listScenariosController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const showAll = req.query.showAll === "true";
    res.render("layout", {
      title: "Scenarios",
      view: "scenarios/index",
      scenarios: await listScenarios({ includeInactive: showAll }),
      showAll
    });
  } catch (error) {
    next(error);
  }
};

export const newScenarioController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const availableAccounts = await db.select().from(accounts).where(eq(accounts.active, true)).orderBy(accounts.name);
    res.render("layout", {
      title: "New Scenario",
      view: "scenarios/form",
      scenario: { name: "", description: "", notes: "", active: true, accountIds: [] },
      accounts: availableAccounts,
      adjustments: []
    });
  } catch (error) {
    next(error);
  }
};

export const editScenarioController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scenario = await getScenario(req.params.id);
    if (!scenario) {
      req.flash("error", "Scenario not found.");
      res.redirect("/scenarios");
      return;
    }
    const availableAccounts = await db.select().from(accounts).where(eq(accounts.active, true)).orderBy(accounts.name);
    res.render("layout", {
      title: "Edit Scenario",
      view: "scenarios/form",
      scenario,
      accounts: availableAccounts,
      adjustments: await listScenarioAdjustments(scenario.id)
    });
  } catch (error) {
    next(error);
  }
};

export const viewScenarioController = async (req: Request, res: Response, next: NextFunction) => {
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
};
