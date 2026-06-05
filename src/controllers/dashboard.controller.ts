import type { Request, Response } from "express";
import { Accounts } from "../services/accounts.service.js";

export const showDashboard = async (_req: Request, res: Response) => {
  const accountRows = await Accounts.list({
    fields: ["id", "name", "type", "currentBalance", "lastReconciledDate"]
  });

  res.render("layout", {
    title: "Dashboard",
    view: "dashboard/index",
    accounts: accountRows
  });
};
