import {
  boolean,
  date,
  integer,
  index,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
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
  "debt",
  "other"
]);

export const transactionStatusEnum = pgEnum("transaction_status", [
  "entered",
  "pending",
  "cleared",
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
  startingInformationBalance: numeric("starting_information_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  startingInformationDate: date("starting_information_date").notNull(),
  startingInformationNotes: text("starting_information_notes"),
  statementChainBalance: numeric("statement_chain_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  lastReconciledDate: date("last_reconciled_date"),
  lastReconciledStatementId: uuid("last_reconciled_statement_id"),
  active: boolean("active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  notes: text("notes"),
  ...timestamps
});

export const accountStatements = pgTable(
  "account_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    statementDate: date("statement_date").notNull(),
    // Convention: "initial" for the first real statement, UUID string for later statements.
    previousStatementId: text("previous_statement_id").notNull(),
    startingBalance: numeric("starting_balance", { precision: 12, scale: 2 }).notNull(),
    endingBalance: numeric("ending_balance", { precision: 12, scale: 2 }).notNull(),
    reconciledBalance: numeric("reconciled_balance", { precision: 12, scale: 2 }).notNull(),
    reconciled: boolean("reconciled").notNull().default(false),
    notes: text("notes"),
    ...timestamps
  },
  (table) => ({
    accountDateIdx: index("account_statements_account_date_idx").on(table.accountId, table.statementDate),
    accountReconciledIdx: index("account_statements_account_reconciled_idx").on(table.accountId, table.reconciled)
  })
);

export const payees = pgTable(
  "payees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    ...timestamps
  },
  (table) => ({
    activeNameIdx: uniqueIndex("payees_active_name_unique").on(table.name, table.active)
  })
);

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: categoryTypeEnum("type").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  ...timestamps
});

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps
  },
  (table) => ({
    activeNameIdx: uniqueIndex("tags_active_name_unique").on(table.name, table.active)
  })
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    status: transactionStatusEnum("status").notNull().default("entered"),
    statementId: uuid("statement_id").references(() => accountStatements.id, { onDelete: "set null" }),
    payeeId: uuid("payee_id").notNull().references(() => payees.id),
    description: text("description"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    notes: text("notes"),
    ...timestamps
  },
  (table) => ({
    accountActiveIdx: index("transactions_account_active_idx").on(table.accountId, table.statementId, table.status),
    accountDateIdx: index("transactions_account_date_idx").on(table.accountId, table.date)
  })
);

export const transactionTags = pgTable(
  "transaction_tags",
  {
    transactionId: uuid("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.transactionId, table.tagId] })
  })
);

export type User = typeof users.$inferSelect;
