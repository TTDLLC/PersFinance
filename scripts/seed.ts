import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { env } from "../src/config/env.js";
import { db, pool } from "../src/db/index.js";
import {
  accountBalanceSnapshots,
  accounts,
  categories,
  users
} from "../src/db/schema.js";

const defaultCategories = [
  ["Housing", "expense"],
  ["Utilities", "expense"],
  ["Subscriptions", "expense"],
  ["Travel", "expense"],
  ["Food", "expense"],
  ["Debt Payment", "debt"],
  ["Income", "income"],
  ["Transfers", "transfer"],
  ["Medical", "expense"],
  ["Auto", "expense"],
  ["Entertainment", "expense"],
  ["Miscellaneous", "other"]
] as const;

const devSeedEnabled = process.argv.includes("--dev") || process.env.SEED_DEMO_DATA === "true";

const ensureInitialStatementSnapshots = async () => {
  const seededAccounts = await db.select().from(accounts);
  const snapshotDate = new Date().toISOString().slice(0, 10);

  for (const account of seededAccounts) {
    const [existingSnapshot] = await db
      .select()
      .from(accountBalanceSnapshots)
      .where(eq(accountBalanceSnapshots.accountId, account.id))
      .limit(1);

    if (!existingSnapshot) {
      await db.insert(accountBalanceSnapshots).values({
        accountId: account.id,
        snapshotDate,
        balance: account.currentBalance,
        source: "seed",
        notes: "Initial statement snapshot from seeded current balance."
      });
    }
  }

  console.log("Initial statement snapshots ensured.");
};

const ensureDevSeedData = async () => {
  const [checking] = await db.select().from(accounts).where(eq(accounts.name, "Main Checking")).limit(1);
  if (!checking) {
    await db.insert(accounts).values({
      name: "Main Checking",
      type: "checking",
      startingBalance: "4250.00",
      currentBalance: "4250.00",
      displayOrder: 1
    });
  }

  const [savings] = await db.select().from(accounts).where(eq(accounts.name, "Emergency Savings")).limit(1);
  if (!savings) {
    await db.insert(accounts).values({
      name: "Emergency Savings",
      type: "savings",
      startingBalance: "12000.00",
      currentBalance: "12000.00",
      displayOrder: 2
    });
  }

  console.log("Developer account seed data ensured.");
};

const main = async () => {
  if (!env.INITIAL_ADMIN_EMAIL || !env.INITIAL_ADMIN_PASSWORD) {
    throw new Error("INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD are required for seeding.");
  }

  const email = env.INITIAL_ADMIN_EMAIL.toLowerCase();
  const [existingUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!existingUser) {
    const passwordHash = await bcrypt.hash(env.INITIAL_ADMIN_PASSWORD, 12);
    await db.insert(users).values({
      email,
      passwordHash,
      displayName: "Robert"
    });
    console.log(`Created initial admin user: ${email}`);
  } else {
    console.log(`Admin user already exists: ${email}`);
  }

  for (const [index, [name, type]] of defaultCategories.entries()) {
    const [existingCategory] = await db.select().from(categories).where(eq(categories.name, name)).limit(1);
    if (!existingCategory) {
      await db.insert(categories).values({ name, type, displayOrder: index + 1 });
    }
  }
  console.log("Default categories ensured.");

  if (devSeedEnabled) {
    await ensureDevSeedData();
  }

  await ensureInitialStatementSnapshots();
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
