import type { Request, Response } from "express";

export const showSettings = async (_req: Request, res: Response) => {
  res.render("layout", {
    title: "Settings",
    view: "settings/index"
  });
};
