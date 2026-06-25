import type { Request, Response } from "express";
import { Accounts } from "../services/accounts.service.js";
import { getAccountProjection } from "../services/projections.service.js";

const selectedAsOfDate = (value: unknown) => {
  const option = Array.isArray(value) ? value[value.length - 1] : value;
  return typeof option === "string" && /^\d{4}-\d{2}-\d{2}$/.test(option) ? option : undefined;
};

export const showDashboard = async (req: Request, res: Response) => {
  const showArchived = req.query.showArchived === "true";
  const asOfDate = selectedAsOfDate(req.query.asOfDate);
  const accountRows = await Accounts.list({
    fields: ["id", "name", "type", "currentBalance", "lastReconciledDate", "active"],
    activeOnly: !showArchived
  });
  const accounts = await Promise.all(
    accountRows.map(async (account) => ({
      ...account,
      projection: await getAccountProjection(String(account.id), { asOfDate, windowDays: 30 })
    }))
  );

  res.render("layout", {
    title: "Dashboard",
    view: "dashboard/index",
    accounts,
    showArchived
  });
};
