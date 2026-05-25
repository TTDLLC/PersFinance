import { Router } from "express";
import { login, logout, showLogin } from "../controllers/auth.controller.js";

export const authRoutes = Router();

authRoutes.get("/login", showLogin);
authRoutes.post("/login", login);
authRoutes.post("/logout", logout);
