import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { futureCommitments, scenarioAccounts, scenarios } from "../db/schema.js";
import { getAccountProjection, projectionWindows } from "../services/projections.service.js";

const selectedWindowDays = (value: unknown) => {
  const option = Number(Array.isArray(value) ? value[value.length - 1] : value);
  return projectionWindows.includes(option as (typeof projectionWindows)[number]) ? option : 30;
};

const selectedScenarioIds = (value: unknown) => {
  const ids = Array.isArray(value) ? value : value ? [value] : [];
  return ids.filter((id): id is string => typeof id === "string" && id.length > 0);
};

export const showAccountForecast = async (req: Request, res: Response) => {
  const accountId = req.params.accountId;
  const windowDays = selectedWindowDays(req.query.window);
  const scenarioIds = selectedScenarioIds(req.query.scenarioIds);

  const projection = await getAccountProjection(accountId, {
    windowDays,
    scenarioIds
  });

  if (!projection) {
    req.flash("error", "Account not found.");
    res.redirect("/accounts");
    return;
  }

  const scenarioOptions = await Promise.all([
    db
      .select({
        id: scenarios.id,
        name: scenarios.name,
        active: scenarios.active
      })
      .from(scenarios)
      .innerJoin(scenarioAccounts, eq(scenarioAccounts.scenarioId, scenarios.id))
      .where(and(eq(scenarios.active, true), eq(scenarioAccounts.accountId, accountId))),
    db
      .selectDistinct({
        id: scenarios.id,
        name: scenarios.name,
        active: scenarios.active
      })
      .from(scenarios)
      .innerJoin(futureCommitments, eq(futureCommitments.scenarioId, scenarios.id))
      .where(and(eq(scenarios.active, true), eq(futureCommitments.accountId, accountId)))
  ]).then(([linkedRows, commitmentRows]) => {
    const byId = new Map([...linkedRows, ...commitmentRows].map((scenario) => [scenario.id, scenario]));
    return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
  });

  res.render("layout", {
    title: `${projection.account.name} Forecast`,
    view: "accounts/forecast",
    projection,
    projectionWindows,
    scenarioOptions,
    selectedScenarioIds: projection.selectedScenarioIds
  });
};
