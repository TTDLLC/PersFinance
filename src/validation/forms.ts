import { z } from "zod";

export const accountTypes = ["checking", "savings", "credit_card", "loan", "cash", "other"] as const;
export const categoryTypes = ["income", "expense", "debt", "other"] as const;
export const transactionStatuses = ["entered", "pending", "cleared", "void"] as const;
export const commitmentFrequencies = ["once", "weekly", "biweekly", "monthly", "quarterly", "yearly"] as const;

const optionalText = z.string().trim().transform((value) => value || null);
const requiredText = (field: string) => z.string().trim().min(1, `${field} is required.`);
const numberFromForm = (field: string) =>
  z.coerce.number({ invalid_type_error: `${field} must be a valid number.` }).finite(`${field} must be a valid number.`);
const optionalUuid = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z.string().uuid().nullable()
);
const checkboxBoolean = z.preprocess(
  (value) => value === true || value === "true" || value === "on" || value === "1",
  z.boolean()
);
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
  payeeId: optionalUuid,
  description: optionalText,
  categoryId: optionalUuid,
  status: z.enum(transactionStatuses),
  notes: optionalText
}).refine((value) => Boolean(value.payeeId || value.description), {
  message: "Payee or Description is required.",
  path: ["description"]
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

export const transferSchema = z
  .object({
    date: requiredDate.refine(validCalendarDate, "A valid transfer date is required."),
    amount: numberFromForm("Amount").positive("Transfer amount must be greater than zero."),
    sourceAccountId: z.string().uuid("A source account is required."),
    destinationAccountId: z.string().uuid("A destination account is required."),
    status: z.enum(["entered", "pending", "cleared"]),
    notes: optionalText
  })
  .refine((value) => value.sourceAccountId !== value.destinationAccountId, {
    message: "Source and destination accounts must be different.",
    path: ["destinationAccountId"]
  });

export const futureCommitmentSchema = z
  .object({
    name: requiredText("Name"),
    payeeId: optionalUuid,
    categoryId: optionalUuid,
    accountId: optionalUuid,
    amount: numberFromForm("Amount").refine((value) => value !== 0, "Amount cannot be zero."),
    frequency: z.enum(commitmentFrequencies),
    nextDueDate: requiredDate.refine(validCalendarDate, "A valid next due date is required."),
    startDate: requiredDate.refine(validCalendarDate, "A valid start date is required."),
    endDate: z.preprocess(
      (value) => (value === "" || value === undefined ? null : value),
      requiredDate.refine(validCalendarDate, "A valid end date is required.").nullable()
    ),
    notes: optionalText,
    active: checkboxBoolean
  })
  .refine((value) => !value.endDate || value.endDate >= value.startDate, {
    message: "End date cannot be before start date.",
    path: ["endDate"]
  })
  .refine((value) => value.nextDueDate >= value.startDate, {
    message: "Next due date cannot be before start date.",
    path: ["nextDueDate"]
  })
  .refine((value) => !value.endDate || value.nextDueDate <= value.endDate, {
    message: "Next due date cannot be after end date.",
    path: ["nextDueDate"]
  });

export const commitmentEntrySchema = z.object({
  accountId: z.string().uuid("An account is required."),
  date: requiredDate.refine(validCalendarDate, "A valid transaction date is required."),
  amount: numberFromForm("Amount").refine((value) => value !== 0, "Amount cannot be zero."),
  notes: optionalText
});

export const firstValidationMessage = (error: z.ZodError) =>
  error.issues[0]?.message ?? "Please correct the highlighted form fields.";
