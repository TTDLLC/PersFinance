import type { Request, Response } from "express";
import { db } from "../db/index.js";
import { projectionSettings } from "../db/schema.js";

export const showSettings = async (_req: Request, res: Response) => {
  const [settings] = await db.select().from(projectionSettings).limit(1);
  res.render("layout", {
    title: "Settings",
    view: "settings/index",
    settings
  });
};
