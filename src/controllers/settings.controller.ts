import type { Request, Response } from "express";
import { REGISTER_FUTURE_WINDOW_DAYS } from "../services/accountRegister.service.js";

export const showSettings = async (_req: Request, res: Response) => {
  res.render("layout", {
    title: "Settings",
    view: "settings/index",
    settings: {
      registerFutureWindowDays: REGISTER_FUTURE_WINDOW_DAYS
    }
  });
};
