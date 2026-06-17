import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts } from "../db/schema.js";
import {
  archiveScenario,
  createScenario,
  getScenario,
  getScenarioAccountOptions,
  listScenarioAdjustments,
  listScenarios,
  updateScenario
} from "../services/scenarios.service.js";

const nullableText = (value: unknown) => {
  const trimmed = String(value ?? "").trim();
  return trimmed.length ? trimmed : null;
};

const checkboxValues = (value: unknown) => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return typeof value === "string" && value.length > 0 ? [value] : [];
};

export const createScenarioController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await createScenario({
      name: String(req.body.name ?? "").trim(),
      description: nullableText(req.body.description),
      notes: nullableText(req.body.notes),
      active: req.body.active === "on",
      accountIds: checkboxValues(req.body.accountIds)
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
      name: String(req.body.name ?? "").trim(),
      description: nullableText(req.body.description),
      notes: nullableText(req.body.notes),
      active: req.body.active === "on",
      accountIds: checkboxValues(req.body.accountIds)
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
      accounts: await getScenarioAccountOptions(scenario.id),
      adjustments: await listScenarioAdjustments(scenario.id)
    });
  } catch (error) {
    next(error);
  }
};
