import type { Request, Response } from "express";

export const showProjectionPlaceholder = async (_req: Request, res: Response) => {
  res.render("layout", {
    title: "Projections",
    view: "projections/index"
  });
};
