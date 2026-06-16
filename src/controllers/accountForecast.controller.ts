import type { Request, Response } from "express";
import { getAccountProjection, projectionWindows } from "../services/projections.service.js";

const selectedWindowDays = (value: unknown) => {
  const option = Number(Array.isArray(value) ? value[value.length - 1] : value);
  return projectionWindows.includes(option as (typeof projectionWindows)[number]) ? option : 30;
};

export const showAccountForecast = async (req: Request, res: Response) => {
  const projection = await getAccountProjection(req.params.accountId, {
    windowDays: selectedWindowDays(req.query.window)
  });

  if (!projection) {
    req.flash("error", "Account not found.");
    res.redirect("/accounts");
    return;
  }

  res.render("layout", {
    title: `${projection.account.name} Forecast`,
    view: "accounts/forecast",
    projection,
    projectionWindows
  });
};
