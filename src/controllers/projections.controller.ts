import type { Request, Response } from "express";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, scenarios } from "../db/schema.js";
import { buildMonthlySummary, buildProjectionRows } from "../services/projection.service.js";

export const showMonthlyProjection = async (req: Request, res: Response) => {
  const hasFilters = Object.keys(req.query).length > 0;
  const options = {
    startDate: typeof req.query.startDate === "string" ? req.query.startDate : undefined,
    monthsAhead: req.query.monthsAhead ? Number(req.query.monthsAhead) : 18,
    scenarioId: typeof req.query.scenarioId === "string" && req.query.scenarioId ? req.query.scenarioId : undefined,
    accountId: typeof req.query.accountId === "string" && req.query.accountId ? req.query.accountId : undefined,
    includeEstimates: hasFilters ? req.query.includeEstimates === "on" : true,
    includePending: hasFilters ? req.query.includePending === "on" : true
  };

  const [rows, monthlySummary, activeScenarios, projectionAccounts] = await Promise.all([
    buildProjectionRows(options),
    buildMonthlySummary({ ...options, accountId: undefined }),
    db.select().from(scenarios).where(eq(scenarios.active, true)).orderBy(asc(scenarios.name)),
    db
      .select()
      .from(accounts)
      .where(and(eq(accounts.active, true), eq(accounts.includeInProjection, true)))
      .orderBy(asc(accounts.displayOrder), asc(accounts.name))
  ]);

  res.render("layout", {
    title: "Monthly Projections",
    view: "projections/monthly",
    rows,
    monthlySummary,
    options,
    scenarios: activeScenarios,
    accounts: projectionAccounts
  });
};
