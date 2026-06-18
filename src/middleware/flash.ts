import type { NextFunction, Request, Response } from "express";

type FlashMessages = Record<string, string[]>;

declare module "express-session" {
  interface SessionData {
    flash?: FlashMessages;
  }
}

declare global {
  namespace Express {
    interface Request {
      flash(type: string, message: string): number;
      flash(type: string): string[];
    }
  }
}

export const flash = (req: Request, _res: Response, next: NextFunction) => {
  function requestFlash(type: string, message: string): number;
  function requestFlash(type: string): string[];
  function requestFlash(type: string, message?: string) {
    req.session.flash ??= {};

    if (message === undefined) {
      const messages = req.session.flash[type] ?? [];
      delete req.session.flash[type];
      return messages;
    }

    req.session.flash[type] ??= [];
    return req.session.flash[type].push(message);
  }

  req.flash = requestFlash;

  next();
};
