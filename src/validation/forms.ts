import { z } from "zod";

export const accountTypes = ["checking", "savings", "credit_card", "loan", "cash", "other"] as const;
export const categoryTypes = ["income", "expense", "transfer", "debt", "other"] as const;
export const amountTypes = ["fixed", "estimate"] as const;
export const scheduleTypes = ["weekly", "biweekly", "monthly", "quarterly", "yearly"] as const;
export const paymentMethods = ["auto_payment", "bill_pay", "online_payment", "swiped", "check", "cash", "manual", "other"] as const;
export const transactionStatuses = ["entered", "pending", "cleared", "statement", "recurring", "void"] as const;

const optionalText = z.string().trim().transform((value) => value || null);
const requiredText = (field: string) => z.string().trim().min(1, `${field} is required.`);
const numberFromForm = (field: string) =>
  z.coerce.number({ invalid_type_error: `${field} must be a valid number.` }).finite(`${field} must be a valid number.`);
const optionalNumberFromForm = (field: string) =>
  z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : value),
    z.coerce.number({ invalid_type_error: `${field} must be a valid number.` }).finite(`${field} must be a valid number.`).optional()
  );
const optionalIntFromForm = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z.coerce.number().int().nullable()
);
const optionalUuid = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z.string().uuid().nullable()
);
const optionalDate = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
);
const requiredDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A valid date is required.");
const validCalendarDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export const accountSchema = z
  .object({
    name: requiredText("Name"),
    type: z.enum(accountTypes),
    startingBalance: numberFromForm("Starting balance").default(0),
    currentBalance: optionalNumberFromForm("Current balance"),
    displayOrder: z.coerce.number().int().default(0),
    notes: optionalText
  })
  .transform((data) => ({
    ...data,
    currentBalance: data.currentBalance ?? data.startingBalance
  }));

export const categorySchema = z.object({
  name: requiredText("Name"),
  type: z.enum(categoryTypes),
  displayOrder: z.coerce.number().int().default(0)
});

export const transactionSchema = z
  .object({
    date: requiredDate,
    description: requiredText("Description"),
    amount: numberFromForm("Amount").refine((value) => value !== 0, "Amount cannot be zero."),
    accountId: optionalUuid,
    categoryId: optionalUuid,
    transactionType: optionalText,
    status: z.enum(transactionStatuses),
    amountType: z.enum(amountTypes),
    paymentMethod: z.enum(paymentMethods),
    recurringGroupId: optionalUuid,
    frequency: z.preprocess(
      (value) => (value === "" || value === undefined ? null : value),
      z.enum(scheduleTypes).nullable()
    ),
    recurringEndDate: optionalDate,
    dayOfMonth: optionalIntFromForm,
    secondDayOfMonth: optionalIntFromForm,
    source: optionalText,
    sourceRowHash: optionalText,
    notes: optionalText
  })
  .refine((data) => !data.dayOfMonth || (data.dayOfMonth >= 1 && data.dayOfMonth <= 31), {
    message: "Day of month must be between 1 and 31.",
    path: ["dayOfMonth"]
  })
  .refine((data) => !data.secondDayOfMonth || (data.secondDayOfMonth >= 1 && data.secondDayOfMonth <= 31), {
    message: "Second day must be between 1 and 31.",
    path: ["secondDayOfMonth"]
  });

export const reconciliationSchema = z.object({
  statementDate: requiredDate.refine(validCalendarDate, "A valid statement date is required."),
  endingBalance: numberFromForm("Ending balance"),
  selectedTransactionIds: z.preprocess((value) => {
    if (value === undefined || value === "") return [];
    return Array.isArray(value) ? value : [value];
  }, z.array(z.string().uuid()))
});

export const scenarioSchema = z.object({
  name: requiredText("Name"),
  description: optionalText,
  active: z.preprocess((value) => value === "on", z.boolean()).optional()
});

export const firstValidationMessage = (error: z.ZodError) =>
  error.issues[0]?.message ?? "Please correct the highlighted form fields.";
