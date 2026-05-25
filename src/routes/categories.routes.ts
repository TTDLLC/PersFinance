import { Router } from "express";
import {
  archiveCategory,
  createCategory,
  editCategory,
  listCategories,
  newCategory,
  updateCategory
} from "../controllers/categories.controller.js";
import { requireAuth } from "../middleware/auth.js";

export const categoriesRoutes = Router();

categoriesRoutes.use(requireAuth);
categoriesRoutes.get("/", listCategories);
categoriesRoutes.get("/new", newCategory);
categoriesRoutes.post("/", createCategory);
categoriesRoutes.get("/:id/edit", editCategory);
categoriesRoutes.post("/:id", updateCategory);
categoriesRoutes.post("/:id/archive", archiveCategory);
