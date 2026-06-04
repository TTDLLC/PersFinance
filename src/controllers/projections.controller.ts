import type { Request, Response } from "express";
import { getRegisterProjections } from "../services/projection.service.js";

const queryValue = (value: unknown) => {
  const lastValue = Array.isArray(value) ? value[value.length - 1] : value;
  return typeof lastValue === "string" ? lastValue : undefined;
};

export const showProjections = async (req: Request, res: Response) => {
  const projection = await getRegisterProjections({
    accountId: queryValue(req.query.accountId),
    startDate: queryValue(req.query.startDate),
    endDate: queryValue(req.query.endDate)
  });

  res.render("layout", {
    title: "Projections",
    view: "projections/index",
    projection
  });
};
