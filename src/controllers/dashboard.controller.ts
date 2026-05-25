import type { Request, Response } from "express";
import {
  buildDashboardProjectionMetrics,
  buildMonthlySummary,
  buildProjectionRows
} from "../services/projection.service.js";

export const showDashboard = async (_req: Request, res: Response) => {
  const [monthlySummary, metrics, projectionRows] = await Promise.all([
    buildMonthlySummary({ monthsAhead: 3 }),
    buildDashboardProjectionMetrics(),
    buildProjectionRows({ monthsAhead: 3 })
  ]);

  res.render("layout", {
    title: "Dashboard",
    view: "dashboard/index",
    monthlySummary: monthlySummary.slice(0, 3),
    upcomingRows: projectionRows.slice(0, 10),
    metrics
  });
};
