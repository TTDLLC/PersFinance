import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, type User } from "../db/schema.js";

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export const attachUser = async (req: Request, _res: Response, next: NextFunction) => {
  if (!req.session.userId) {
    next();
    return;
  }

  const [user] = await db.select().from(users).where(eq(users.id, req.session.userId)).limit(1);
  if (user?.active) {
    req.user = user;
  }

  next();
};

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    req.flash("error", "Please log in to continue.");
    res.redirect("/login");
    return;
  }

  next();
};
