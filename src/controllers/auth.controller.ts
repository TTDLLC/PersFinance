import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";

export const showLogin = (req: Request, res: Response) => {
  if (req.user) {
    res.redirect("/dashboard");
    return;
  }

  res.render("layout", { title: "Login", view: "auth/login" });
};

export const login = async (req: Request, res: Response) => {
  const email = String(req.body.email ?? "").trim().toLowerCase();
  const password = String(req.body.password ?? "");
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (!user?.active || !(await bcrypt.compare(password, user.passwordHash))) {
    req.flash("error", "Invalid email or password.");
    res.redirect("/login");
    return;
  }

  req.session.userId = user.id;
  req.flash("success", "Logged in.");
  res.redirect("/dashboard");
};

export const logout = (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
};
