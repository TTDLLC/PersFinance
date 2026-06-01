import {
  boolean,
  date,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
};

export const accountTypeEnum = pgEnum("account_type", [
  "checking",
  "savings",
  "credit_card",
  "loan",
  "cash",
  "other"
]);

export const categoryTypeEnum = pgEnum("category_type", [
  "income",
  "expense",
  "transfer",
  "debt",
  "other"
]);

export const recurringKindEnum = pgEnum("recurring_kind", [
  "bill",
  "income",
  "transfer",
  "debt_payment"
]);

export const amountTypeEnum = pgEnum("amount_type", ["fixed", "estimate"]);

export const scheduleTypeEnum = pgEnum("schedule_type", [
  "weekly",
  "biweekly",
  "semimonthly",
  "monthly",
  "custom"
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "auto_payment",
  "bill_pay",
  "online_payment",
  "swiped",
  "check",
  "cash",
  "manual",
  "other"
]);

export const recurringStatusEnum = pgEnum("recurring_status", [
  "planned",
  "pending",
  "cleared",
  "reconciled",
  "estimate",
  "archived"
]);

export const futureTransactionTypeEnum = pgEnum("future_transaction_type", [
  "bill",
  "income",
  "transfer",
  "debt_payment",
  "vacation_payment",
  "manual_adjustment",
  "purchase",
  "refund",
  "other"
]);

export const futureTransactionStatusEnum = pgEnum("future_transaction_status", [
  "planned",
  "pending",
  "cleared",
  "estimate",
  "cancelled"
]);

export const importStatusEnum = pgEnum("import_status", [
  "pending",
  "processed",
  "failed",
  "archived"
]);

export const actualTransactionStatusEnum = pgEnum("actual_transaction_status", [
  "pending",
  "cleared",
  "reconciled",
  "ignored"
]);

export const transactionStatusEnum = pgEnum("transaction_status", [
  "entered",
  "pending",
  "cleared",
  "statement",
  "recurring",
  "archived",
  "void"
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps
  },
  (table) => ({
    emailIdx: uniqueIndex("users_email_unique").on(table.email)
  })
);

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: accountTypeEnum("type").notNull(),
  startingBalance: numeric("starting_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  currentBalance: numeric("current_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  includeInProjection: boolean("include_in_projection").notNull().default(true),
  active: boolean("active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  notes: text("notes"),
  ...timestamps
});

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: categoryTypeEnum("type").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  ...timestamps
});

export const scenarios = pgTable("scenarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  isDefault: boolean("is_default").notNull().default(false),
  active: boolean("active").notNull().default(true),
  ...timestamps
});

export const recurringTransactions = pgTable("recurring_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: recurringKindEnum("kind").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  amountType: amountTypeEnum("amount_type").notNull().default("fixed"),
  scheduleType: scheduleTypeEnum("schedule_type").notNull(),
  dayOfMonth: integer("day_of_month"),
  secondDayOfMonth: integer("second_day_of_month"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
  paymentMethod: paymentMethodEnum("payment_method").notNull().default("manual"),
  status: recurringStatusEnum("status").notNull().default("planned"),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  ...timestamps
});

export const futureTransactions = pgTable("future_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  date: date("date").notNull(),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
  transactionType: futureTransactionTypeEnum("transaction_type").notNull(),
  status: futureTransactionStatusEnum("status").notNull().default("planned"),
  scenarioId: uuid("scenario_id").references(() => scenarios.id, { onDelete: "set null" }),
  includeInProjection: boolean("include_in_projection").notNull().default(true),
  notes: text("notes"),
  ...timestamps
});

export const projectionSettings = pgTable("projection_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  defaultStartDate: date("default_start_date"),
  defaultMonthsAhead: integer("default_months_ahead").notNull().default(18),
  includeEstimates: boolean("include_estimates").notNull().default(true),
  includePending: boolean("include_pending").notNull().default(true),
  ...timestamps
});

export const importBatches = pgTable("import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceName: text("source_name").notNull(),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  fileName: text("file_name"),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  rowCount: integer("row_count").notNull().default(0),
  status: importStatusEnum("status").notNull().default("pending"),
  notes: text("notes"),
  ...timestamps
});

export const actualTransactions = pgTable("actual_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  date: date("date").notNull(),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 12, scale: 2 }),
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
  transactionType: text("transaction_type"),
  status: actualTransactionStatusEnum("status").notNull().default("cleared"),
  source: text("source"),
  sourceRowHash: text("source_row_hash"),
  importBatchId: uuid("import_batch_id").references(() => importBatches.id, { onDelete: "set null" }),
  notes: text("notes"),
  ...timestamps
});

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
  date: date("date").notNull(),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  transactionType: text("transaction_type"),
  status: transactionStatusEnum("status").notNull().default("entered"),
  amountType: amountTypeEnum("amount_type").notNull().default("fixed"),
  paymentMethod: paymentMethodEnum("payment_method").notNull().default("manual"),
  recurringGroupId: uuid("recurring_group_id"),
  frequency: scheduleTypeEnum("frequency"),
  recurringEndDate: date("recurring_end_date"),
  dayOfMonth: integer("day_of_month"),
  secondDayOfMonth: integer("second_day_of_month"),
  source: text("source"),
  sourceRowHash: text("source_row_hash"),
  importBatchId: uuid("import_batch_id").references(() => importBatches.id, { onDelete: "set null" }),
  notes: text("notes"),
  ...timestamps
});

export const accountBalanceSnapshots = pgTable("account_balance_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
  snapshotDate: date("snapshot_date").notNull(),
  balance: numeric("balance", { precision: 12, scale: 2 }).notNull(),
  source: text("source"),
  notes: text("notes"),
  ...timestamps
});

export type User = typeof users.$inferSelect;
