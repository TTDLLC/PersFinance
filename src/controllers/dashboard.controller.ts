import type { Request, Response } from "express";
import { getAllAccountWorkingBalances } from "../services/balance.service.js";

export const showDashboard = async (_req: Request, res: Response) => {
  const workingBalances = await getAllAccountWorkingBalances();
  const totalWorkingBalance = workingBalances.reduce((sum, balance) => sum + balance.workingBalance, 0);
  const totalSnapshotBalance = workingBalances.reduce((sum, balance) => sum + balance.latestSnapshotBalance, 0);
  const totalPostSnapshotActivity = workingBalances.reduce((sum, balance) => sum + balance.postSnapshotActivityTotal, 0);

  res.render("layout", {
    title: "Dashboard",
    view: "dashboard/index",
    workingBalances,
    metrics: {
      totalWorkingBalance,
      totalSnapshotBalance,
      totalPostSnapshotActivity,
      accountCount: workingBalances.length
    }
  });
};
