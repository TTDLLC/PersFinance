import type { Request, Response } from "express";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { categories } from "../db/schema.js";
import { categorySchema, categoryTypes, firstValidationMessage } from "../validation/forms.js";

export const listCategories = async (_req: Request, res: Response) => {
  const rows = await db.select().from(categories).orderBy(asc(categories.displayOrder), asc(categories.name));
  res.render("layout", { title: "Categories", view: "categories/index", categories: rows });
};

export const newCategory = (_req: Request, res: Response) => {
  res.render("layout", { title: "New Category", view: "categories/form", category: {}, categoryTypes });
};

export const createCategory = async (req: Request, res: Response) => {
  const parsed = categorySchema.safeParse(req.body);
  if (!parsed.success) {
    req.flash("error", firstValidationMessage(parsed.error));
    res.status(422).render("layout", { title: "New Category", view: "categories/form", category: req.body, categoryTypes });
    return;
  }

  const data = parsed.data;
  await db.insert(categories).values({
    name: data.name,
    type: data.type,
    displayOrder: data.displayOrder
  });
  req.flash("success", "Category created.");
  res.redirect("/categories");
};

export const editCategory = async (req: Request, res: Response) => {
  const [category] = await db.select().from(categories).where(eq(categories.id, req.params.id)).limit(1);
  if (!category) {
    req.flash("error", "Category not found.");
    res.redirect("/categories");
    return;
  }
  res.render("layout", { title: "Edit Category", view: "categories/form", category, categoryTypes });
};

export const updateCategory = async (req: Request, res: Response) => {
  const parsed = categorySchema.safeParse(req.body);
  if (!parsed.success) {
    req.flash("error", firstValidationMessage(parsed.error));
    res.status(422).render("layout", {
      title: "Edit Category",
      view: "categories/form",
      category: { ...req.body, id: req.params.id, active: true },
      categoryTypes
    });
    return;
  }

  const data = parsed.data;
  await db
    .update(categories)
    .set({
      name: data.name,
      type: data.type,
      displayOrder: data.displayOrder,
      updatedAt: new Date()
    })
    .where(eq(categories.id, req.params.id));
  req.flash("success", "Category updated.");
  res.redirect("/categories");
};

export const archiveCategory = async (req: Request, res: Response) => {
  await db.update(categories).set({ active: false, updatedAt: new Date() }).where(eq(categories.id, req.params.id));
  req.flash("success", "Category archived.");
  res.redirect("/categories");
};
