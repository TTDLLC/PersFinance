import type { Request, Response, NextFunction } from "express";
import {
  archiveScenario,
  createScenario,
  getScenario,
  getScenarioAccountOptions,
  listScenarios,
  updateScenario
} from "../services/scenarios.service.js";
import { listScenarioCommitments } from "../services/futureCommitments.service.js";
import { archiveToggleHref } from "./archiveToggle.js";

const nullableText = (value: unknown) => {
  const trimmed = String(value ?? "").trim();
  return trimmed.length ? trimmed : null;
};

export const createScenarioController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await createScenario({
      name: String(req.body.name ?? "").trim(),
      description: nullableText(req.body.description),
      notes: nullableText(req.body.notes),
      active: req.body.active === "on"
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
      active: req.body.active === "on"
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
    const showArchived = req.query.showArchived === "true" || req.query.showAll === "true";
    res.render("layout", {
      title: "Scenarios",
      view: "scenarios/index",
      scenarios: await listScenarios({ includeInactive: showArchived }),
      showArchived,
      showAll: showArchived,
      archiveToggleHref: archiveToggleHref("/scenarios", req.query, showArchived, { aliases: ["showAll"] })
    });
  } catch (error) {
    next(error);
  }
};

export const newScenarioController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.render("layout", {
      title: "New Scenario",
      view: "scenarios/form",
      scenario: { name: "", description: "", notes: "", active: true }
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
    res.render("layout", {
      title: "Edit Scenario",
      view: "scenarios/form",
      scenario,
      items: await listScenarioCommitments(scenario.id)
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
      items: await listScenarioCommitments(scenario.id)
    });
  } catch (error) {
    next(error);
  }
};
