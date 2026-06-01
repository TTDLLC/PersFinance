import type { Request, Response } from "express";
import {
  buildDashboardProjectionMetrics,
  buildMonthlySummary,
  buildProjectionRows
} from "../services/projection.service.js";
import { getAllAccountWorkingBalances } from "../services/balance.service.js";

export const showDashboard = async (_req: Request, res: Response) => {
  const [monthlySummary, metrics, projectionRows, workingBalances] = await Promise.all([
    buildMonthlySummary({ monthsAhead: 3 }),
    buildDashboardProjectionMetrics(),
    buildProjectionRows({ monthsAhead: 3 }),
    getAllAccountWorkingBalances()
  ]);

  res.render("layout", {
    title: "Dashboard",
    view: "dashboard/index",
    monthlySummary: monthlySummary.slice(0, 3),
    upcomingRows: projectionRows.slice(0, 10),
    workingBalances,
    metrics
  });
};
