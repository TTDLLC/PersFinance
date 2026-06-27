import type { Request, Response } from "express";
import { and, eq, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { futureCommitments, scenarios } from "../db/schema.js";
import { defaultProjectionWindowDays, getAccountProjection, maxProjectionWindowDays, normalizeProjectionWindowDays } from "../services/projections.service.js";

const selectedWindowDays = (value: unknown) => {
  const option = Array.isArray(value) ? value[value.length - 1] : value;
  return normalizeProjectionWindowDays(Number(option));
};

const selectedScenarioIds = (value: unknown) => {
  const ids = Array.isArray(value) ? value : value ? [value] : [];
  return ids.filter((id): id is string => typeof id === "string" && id.length > 0);
};

const selectedAsOfDate = (value: unknown) => {
  const option = Array.isArray(value) ? value[value.length - 1] : value;
  return typeof option === "string" && /^\d{4}-\d{2}-\d{2}$/.test(option) ? option : undefined;
};

export const showAccountForecast = async (req: Request, res: Response) => {
  const accountId = req.params.accountId;
  const windowDays = selectedWindowDays(req.query.windowDays ?? req.query.window);
  const scenarioIds = selectedScenarioIds(req.query.scenarioIds);
  const asOfDate = selectedAsOfDate(req.query.asOfDate);

  const projection = await getAccountProjection(accountId, {
    asOfDate,
    windowDays,
    scenarioIds
  });

  if (!projection) {
    req.flash("error", "Account not found.");
    res.redirect("/accounts");
    return;
  }

  const scenarioOptions = await db
    .selectDistinct({
      id: scenarios.id,
      name: scenarios.name,
      active: scenarios.active
    })
    .from(scenarios)
    .innerJoin(futureCommitments, eq(futureCommitments.scenarioId, scenarios.id))
    .where(
      and(
        eq(scenarios.active, true),
        or(
          eq(futureCommitments.accountId, accountId),
          eq(futureCommitments.transferFromAccountId, accountId),
          eq(futureCommitments.transferToAccountId, accountId)
        ),
        eq(futureCommitments.includeInBaseline, false),
        eq(futureCommitments.active, true)
      )
    )
    .orderBy(scenarios.name);

  res.render("layout", {
    title: `${projection.account.name} Forecast`,
    view: "accounts/forecast",
    projection,
    defaultProjectionWindowDays,
    maxProjectionWindowDays,
    scenarioOptions,
    selectedScenarioIds: projection.selectedScenarioIds
  });
};
