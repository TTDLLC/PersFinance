import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { env } from "../src/config/env.js";
import { db, pool } from "../src/db/index.js";
import {
  accountBalanceSnapshots,
  accounts,
  categories,
  futureTransactions,
  projectionSettings,
  recurringTransactions,
  scenarios,
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

const findCategoryId = async (name: string) => {
  const [category] = await db.select().from(categories).where(eq(categories.name, name)).limit(1);
  if (!category) throw new Error(`Missing seeded category: ${name}`);
  return category.id;
};

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
  const [existingScenario] = await db.select().from(scenarios).where(eq(scenarios.name, "Vacation Heavy Plan")).limit(1);
  const vacationScenario =
    existingScenario ??
    (
      await db
        .insert(scenarios)
        .values({
          name: "Vacation Heavy Plan",
          description: "Optional overlay with additional vacation spending.",
          isDefault: false
        })
        .returning()
    )[0];

  const [checking] = await db.select().from(accounts).where(eq(accounts.name, "Main Checking")).limit(1);
  const checkingId =
    checking?.id ??
    (
      await db
        .insert(accounts)
        .values({
          name: "Main Checking",
          type: "checking",
          startingBalance: "4250.00",
          currentBalance: "4250.00",
          includeInProjection: true,
          displayOrder: 1
        })
        .returning({ id: accounts.id })
    )[0].id;

  const [savings] = await db.select().from(accounts).where(eq(accounts.name, "Emergency Savings")).limit(1);
  if (!savings) {
    await db.insert(accounts).values({
      name: "Emergency Savings",
      type: "savings",
      startingBalance: "12000.00",
      currentBalance: "12000.00",
      includeInProjection: true,
      displayOrder: 2
    });
  }

  const incomeCategoryId = await findCategoryId("Income");
  const housingCategoryId = await findCategoryId("Housing");
  const utilitiesCategoryId = await findCategoryId("Utilities");
  const subscriptionsCategoryId = await findCategoryId("Subscriptions");
  const travelCategoryId = await findCategoryId("Travel");

  const recurringSeeds = [
    {
      name: "Paycheck",
      kind: "income" as const,
      amount: "3200.00",
      amountType: "fixed" as const,
      scheduleType: "biweekly" as const,
      startDate: "2026-05-29",
      accountId: checkingId,
      categoryId: incomeCategoryId,
      paymentMethod: "manual" as const,
      status: "planned" as const
    },
    {
      name: "Mortgage",
      kind: "bill" as const,
      amount: "-1850.00",
      amountType: "fixed" as const,
      scheduleType: "monthly" as const,
      dayOfMonth: 1,
      startDate: "2026-06-01",
      accountId: checkingId,
      categoryId: housingCategoryId,
      paymentMethod: "auto_payment" as const,
      status: "planned" as const
    },
    {
      name: "Electric Estimate",
      kind: "bill" as const,
      amount: "-180.00",
      amountType: "estimate" as const,
      scheduleType: "monthly" as const,
      dayOfMonth: 12,
      startDate: "2026-06-12",
      accountId: checkingId,
      categoryId: utilitiesCategoryId,
      paymentMethod: "auto_payment" as const,
      status: "estimate" as const
    },
    {
      name: "Streaming Bundle",
      kind: "bill" as const,
      amount: "-68.00",
      amountType: "fixed" as const,
      scheduleType: "monthly" as const,
      dayOfMonth: 18,
      startDate: "2026-06-18",
      accountId: checkingId,
      categoryId: subscriptionsCategoryId,
      paymentMethod: "online_payment" as const,
      status: "planned" as const
    }
  ];

  for (const seed of recurringSeeds) {
    const [existing] = await db.select().from(recurringTransactions).where(eq(recurringTransactions.name, seed.name)).limit(1);
    if (!existing) await db.insert(recurringTransactions).values(seed);
  }

  const [vacationPayment] = await db
    .select()
    .from(futureTransactions)
    .where(eq(futureTransactions.description, "Vacation final payment"))
    .limit(1);
  if (!vacationPayment) {
    await db.insert(futureTransactions).values({
      date: "2026-08-15",
      description: "Vacation final payment",
      amount: "-1200.00",
      accountId: checkingId,
      categoryId: travelCategoryId,
      transactionType: "vacation_payment",
      status: "planned",
      scenarioId: vacationScenario.id,
      includeInProjection: true
    });
  }

  console.log("Developer seed data ensured.");
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

  const existingSettings = await db.select().from(projectionSettings).limit(1);
  if (!existingSettings.length) {
    await db.insert(projectionSettings).values({
      defaultMonthsAhead: 18,
      includeEstimates: true,
      includePending: true
    });
  }
  console.log("Projection settings ensured.");

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
