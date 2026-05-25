import type { Request, Response } from "express";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { scenarios } from "../db/schema.js";
import { firstValidationMessage, scenarioSchema } from "../validation/forms.js";

export const listScenarios = async (_req: Request, res: Response) => {
  const rows = await db.select().from(scenarios).orderBy(asc(scenarios.name));
  res.render("layout", { title: "Scenarios", view: "scenarios/index", scenarios: rows });
};

export const newScenario = (_req: Request, res: Response) => {
  res.render("layout", { title: "New Scenario", view: "scenarios/form", scenario: {} });
};

export const createScenario = async (req: Request, res: Response) => {
  const parsed = scenarioSchema.safeParse(req.body);
  if (!parsed.success) {
    req.flash("error", firstValidationMessage(parsed.error));
    res.status(422).render("layout", { title: "New Scenario", view: "scenarios/form", scenario: req.body });
    return;
  }

  const data = parsed.data;
  await db.insert(scenarios).values({
    name: data.name,
    description: data.description,
    isDefault: data.isDefault
  });
  req.flash("success", "Scenario created.");
  res.redirect("/scenarios");
};

export const editScenario = async (req: Request, res: Response) => {
  const [scenario] = await db.select().from(scenarios).where(eq(scenarios.id, req.params.id)).limit(1);
  if (!scenario) {
    req.flash("error", "Scenario not found.");
    res.redirect("/scenarios");
    return;
  }
  res.render("layout", { title: "Edit Scenario", view: "scenarios/form", scenario });
};

export const updateScenario = async (req: Request, res: Response) => {
  const parsed = scenarioSchema.safeParse(req.body);
  if (!parsed.success) {
    req.flash("error", firstValidationMessage(parsed.error));
    res.status(422).render("layout", {
      title: "Edit Scenario",
      view: "scenarios/form",
      scenario: { ...req.body, id: req.params.id }
    });
    return;
  }

  const data = parsed.data;
  await db
    .update(scenarios)
    .set({
      name: data.name,
      description: data.description,
      isDefault: data.isDefault,
      active: data.active ?? false,
      updatedAt: new Date()
    })
    .where(eq(scenarios.id, req.params.id));
  req.flash("success", "Scenario updated.");
  res.redirect("/scenarios");
};
