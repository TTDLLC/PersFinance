import type { Request, Response } from "express";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { payees } from "../db/schema.js";
import { firstValidationMessage, payeeSchema } from "../validation/forms.js";
import { archiveToggleHref } from "./archiveToggle.js";

const queryFlag = (value: unknown, defaultValue: boolean) => {
  const lastValue = Array.isArray(value) ? value[value.length - 1] : value;
  if (lastValue === "true" || lastValue === "on") return true;
  if (lastValue === "false") return false;
  return defaultValue;
};

const normalizeName = (name: string) => name.trim().toLowerCase();

const activeNameExists = async (name: string, exceptId?: string) => {
  const filters = [eq(payees.active, true), sql`lower(${payees.name}) = ${normalizeName(name)}`];
  if (exceptId) filters.push(ne(payees.id, exceptId));
  const [payee] = await db.select({ id: payees.id }).from(payees).where(and(...filters)).limit(1);
  return Boolean(payee);
};

export const listPayees = async (req: Request, res: Response) => {
  const showArchived = queryFlag(req.query.showArchived, false);
  const rows = await db
    .select()
    .from(payees)
    .where(showArchived ? undefined : eq(payees.active, true))
    .orderBy(desc(payees.active), asc(payees.name));

  res.render("layout", {
    title: "Payees",
    view: "payees/index",
    payees: rows,
    showArchived,
    archiveToggleHref: archiveToggleHref("/payees", req.query, showArchived)
  });
};

export const newPayee = (_req: Request, res: Response) => {
  res.render("layout", { title: "New Payee", view: "payees/form", payee: {} });
};

export const createPayee = async (req: Request, res: Response) => {
  const parsed = payeeSchema.safeParse(req.body);
  if (!parsed.success || (parsed.success && await activeNameExists(parsed.data.name))) {
    req.flash("error", parsed.success ? "An active payee with that name already exists." : firstValidationMessage(parsed.error));
    res.status(422).render("layout", { title: "New Payee", view: "payees/form", payee: req.body });
    return;
  }

  await db.insert(payees).values(parsed.data);
  req.flash("success", "Payee created.");
  res.redirect("/payees");
};

export const editPayee = async (req: Request, res: Response) => {
  const [payee] = await db.select().from(payees).where(eq(payees.id, req.params.id)).limit(1);
  if (!payee) {
    req.flash("error", "Payee not found.");
    res.redirect("/payees");
    return;
  }

  res.render("layout", { title: "Edit Payee", view: "payees/form", payee });
};

export const updatePayee = async (req: Request, res: Response) => {
  const parsed = payeeSchema.safeParse(req.body);
  const [existing] = await db.select().from(payees).where(eq(payees.id, req.params.id)).limit(1);
  if (!existing) {
    req.flash("error", "Payee not found.");
    res.redirect("/payees");
    return;
  }

  if (!parsed.success || (existing.active && await activeNameExists(parsed.data.name, existing.id))) {
    req.flash("error", parsed.success ? "An active payee with that name already exists." : firstValidationMessage(parsed.error));
    res.status(422).render("layout", {
      title: "Edit Payee",
      view: "payees/form",
      payee: { ...req.body, id: existing.id, active: existing.active }
    });
    return;
  }

  await db.update(payees).set({ ...parsed.data, updatedAt: new Date() }).where(eq(payees.id, existing.id));
  req.flash("success", "Payee updated.");
  res.redirect("/payees");
};

export const archivePayee = async (req: Request, res: Response) => {
  await db.update(payees).set({ active: false, updatedAt: new Date() }).where(eq(payees.id, req.params.id));
  req.flash("success", "Payee archived. Historical transactions keep their payee.");
  res.redirect("/payees");
};
