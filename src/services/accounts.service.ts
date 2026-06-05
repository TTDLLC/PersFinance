import { asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts } from "../db/schema.js";
import { Account } from "./account.service.js";

type AccountField =
  | "id"
  | "name"
  | "type"
  | "startingInformation"
  | "currentBalance"
  | "statementBalance"
  | "lastReconciledDate"
  | "lastReconciledStatementId"
  | "active"
  | "displayOrder"
  | "notes";

export type AccountsListOptions = {
  fields?: AccountField[];
  activeOnly?: boolean;
};

export type CreateAccountInput = {
  name: string;
  type: typeof accounts.$inferInsert.type;
  startingInformation: {
    balance: string;
    date: string;
    notes?: string | null;
  };
  displayOrder?: number;
  notes?: string | null;
};

const fullFields: AccountField[] = [
  "id",
  "name",
  "type",
  "startingInformation",
  "currentBalance",
  "statementBalance",
  "lastReconciledDate",
  "lastReconciledStatementId",
  "active",
  "displayOrder",
  "notes"
];

const pickFields = async (account: Account, fields: AccountField[]) => {
  const data = account.data;
  const row: Record<string, unknown> = {};

  for (const field of fields) {
    if (field === "startingInformation") row.startingInformation = account.getStartingInformation();
    if (field === "currentBalance") row.currentBalance = await account.getBalance();
    if (field === "statementBalance") row.statementBalance = account.getStatementBalance();
    if (field === "lastReconciledDate") row.lastReconciledDate = account.getDisplayStatementDate();
    if (field === "lastReconciledStatementId") row.lastReconciledStatementId = account.getLastReconciledStatementId();
    if (field === "id") row.id = data.id;
    if (field === "name") row.name = data.name;
    if (field === "type") row.type = data.type;
    if (field === "active") row.active = data.active;
    if (field === "displayOrder") row.displayOrder = data.displayOrder;
    if (field === "notes") row.notes = data.notes;
  }

  return row;
};

export const Accounts = {
  async list(options: AccountsListOptions = {}) {
    const rows = await db
      .select()
      .from(accounts)
      .where(options.activeOnly ?? true ? eq(accounts.active, true) : undefined)
      .orderBy(asc(accounts.displayOrder), asc(accounts.name));

    const fields = options.fields ?? fullFields;
    return Promise.all(rows.map((row) => pickFields(new Account(row), fields)));
  },

  async getAccount(accountId: string) {
    const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
    return row ? new Account(row) : null;
  },

  async createAccount(input: CreateAccountInput) {
    const [created] = await db
      .insert(accounts)
      .values({
        name: input.name,
        type: input.type,
        startingInformationBalance: input.startingInformation.balance,
        startingInformationDate: input.startingInformation.date,
        startingInformationNotes: input.startingInformation.notes ?? null,
        statementChainBalance: input.startingInformation.balance,
        lastReconciledDate: null,
        lastReconciledStatementId: null,
        displayOrder: input.displayOrder ?? 0,
        notes: input.notes ?? null
      })
      .returning();

    if (!created) throw new Error("Could not create account.");
    return new Account(created);
  }
};
