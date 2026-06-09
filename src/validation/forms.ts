import { z } from "zod";

export const accountTypes = ["checking", "savings", "credit_card", "loan", "cash", "other"] as const;
export const categoryTypes = ["income", "expense", "debt", "other"] as const;
export const transactionStatuses = ["entered", "pending", "cleared", "void"] as const;

const optionalText = z.string().trim().transform((value) => value || null);
const requiredText = (field: string) => z.string().trim().min(1, `${field} is required.`);
const numberFromForm = (field: string) =>
  z.coerce.number({ invalid_type_error: `${field} must be a valid number.` }).finite(`${field} must be a valid number.`);
const optionalUuid = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z.string().uuid().nullable()
);
const requiredUuid = (field: string) => z.string().uuid(`${field} is required.`);
const requiredDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A valid date is required.");
const validCalendarDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export const accountSchema = z.object({
  name: requiredText("Name"),
  type: z.enum(accountTypes),
  startingInformationBalance: numberFromForm("Starting balance").default(0),
  startingInformationDate: requiredDate.refine(validCalendarDate, "A valid starting date is required."),
  startingInformationNotes: optionalText,
  displayOrder: z.coerce.number().int().default(0),
  notes: optionalText
});

export const categorySchema = z.object({
  name: requiredText("Name"),
  type: z.enum(categoryTypes)
});

export const payeeSchema = z.object({
  name: requiredText("Payee name"),
  notes: optionalText
});

export const transactionSchema = z.object({
  date: requiredDate.refine(validCalendarDate, "A valid transaction date is required."),
  amount: numberFromForm("Amount").refine((value) => value !== 0, "Amount cannot be zero."),
  accountId: optionalUuid,
  payeeId: requiredUuid("Payee"),
  description: optionalText,
  categoryId: optionalUuid,
  status: z.enum(transactionStatuses),
  notes: optionalText
});

export const reconciliationSchema = z.object({
  statementDate: requiredDate.refine(validCalendarDate, "A valid statement date is required."),
  endingBalance: numberFromForm("Ending balance"),
  notes: optionalText,
  selectedTransactionIds: z.preprocess((value) => {
    if (value === undefined || value === "") return [];
    return Array.isArray(value) ? value : [value];
  }, z.array(z.string().uuid()))
});

export const firstValidationMessage = (error: z.ZodError) =>
  error.issues[0]?.message ?? "Please correct the highlighted form fields.";
