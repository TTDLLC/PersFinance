import type { Request, Response } from "express";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { categories, transactions } from "../db/schema.js";
import { categorySchema, categoryTypes, firstValidationMessage } from "../validation/forms.js";

const queryFlag = (value: unknown, defaultValue: boolean) => {
  const lastValue = Array.isArray(value) ? value[value.length - 1] : value;
  if (lastValue === "true" || lastValue === "on") return true;
  if (lastValue === "false") return false;
  return defaultValue;
};

const normalizeName = (name: string) => name.trim().toLowerCase();

const activeNameExists = async (name: string, exceptId?: string) => {
  const filters = [eq(categories.active, true), sql`lower(${categories.name}) = ${normalizeName(name)}`];
  if (exceptId) filters.push(ne(categories.id, exceptId));
  const [category] = await db.select({ id: categories.id }).from(categories).where(and(...filters)).limit(1);
  return Boolean(category);
};

const categoryUsageCount = async (categoryId: string) => {
  const [usage] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(eq(transactions.categoryId, categoryId));
  return usage?.count ?? 0;
};

const categoriesWithUsage = async (showArchived: boolean) => {
  const filters = showArchived ? undefined : eq(categories.active, true);
  return db
    .select({
      id: categories.id,
      name: categories.name,
      type: categories.type,
      displayOrder: categories.displayOrder,
      active: categories.active,
      usageCount: sql<number>`count(${transactions.id})::int`
    })
    .from(categories)
    .leftJoin(transactions, eq(transactions.categoryId, categories.id))
    .where(filters)
    .groupBy(categories.id)
    .orderBy(desc(categories.active), asc(categories.displayOrder), asc(categories.name));
};

export const listCategories = async (req: Request, res: Response) => {
  const showArchived = queryFlag(req.query.showArchived, false);
  const rows = await categoriesWithUsage(showArchived);
  res.render("layout", { title: "Categories", view: "categories/index", categories: rows, showArchived });
};

export const newCategory = (_req: Request, res: Response) => {
  res.render("layout", { title: "New Category", view: "categories/form", category: {}, categoryTypes, usageCount: 0 });
};

export const createCategory = async (req: Request, res: Response) => {
  const parsed = categorySchema.safeParse(req.body);
  if (!parsed.success) {
    req.flash("error", firstValidationMessage(parsed.error));
    res.status(422).render("layout", { title: "New Category", view: "categories/form", category: req.body, categoryTypes });
    return;
  }

  const data = parsed.data;
  if (await activeNameExists(data.name)) {
    req.flash("error", "An active category with that name already exists.");
    res.status(422).render("layout", { title: "New Category", view: "categories/form", category: req.body, categoryTypes, usageCount: 0 });
    return;
  }

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
  res.render("layout", { title: "Edit Category", view: "categories/form", category, categoryTypes, usageCount: await categoryUsageCount(category.id) });
};

export const updateCategory = async (req: Request, res: Response) => {
  const parsed = categorySchema.safeParse(req.body);
  if (!parsed.success) {
    req.flash("error", firstValidationMessage(parsed.error));
    res.status(422).render("layout", {
      title: "Edit Category",
      view: "categories/form",
      category: { ...req.body, id: req.params.id, active: true },
      categoryTypes,
      usageCount: await categoryUsageCount(req.params.id)
    });
    return;
  }

  const data = parsed.data;
  const [existing] = await db.select().from(categories).where(eq(categories.id, req.params.id)).limit(1);
  if (!existing) {
    req.flash("error", "Category not found.");
    res.redirect("/categories");
    return;
  }

  if (existing.active && (await activeNameExists(data.name, existing.id))) {
    req.flash("error", "An active category with that name already exists.");
    res.status(422).render("layout", {
      title: "Edit Category",
      view: "categories/form",
      category: { ...req.body, id: req.params.id, active: existing.active },
      categoryTypes,
      usageCount: await categoryUsageCount(existing.id)
    });
    return;
  }

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
  const usageCount = await categoryUsageCount(req.params.id);
  await db.update(categories).set({ active: false, updatedAt: new Date() }).where(eq(categories.id, req.params.id));
  req.flash("success", usageCount ? `Category archived. ${usageCount} transaction(s) keep this category historically.` : "Category archived.");
  res.redirect("/categories");
};
