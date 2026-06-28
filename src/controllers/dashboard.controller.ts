import type { Request, Response } from "express";
import { isoToday, listUpcomingCommitments } from "../services/futureCommitments.service.js";

export const showDashboard = async (req: Request, res: Response) => {
  const today = isoToday();

  res.render("layout", {
    title: "Dashboard",
    view: "dashboard/index",
    upcomingCommitments: await listUpcomingCommitments(today, 14),
    today
  });
};
