import { and, asc, eq, gt, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { aliasedTable } from "drizzle-orm/alias";
import { db } from "../db/index.js";
import { accounts, categories, futureCommitments, payees, transactions } from "../db/schema.js";
import { advanceDueDate, isoToday } from "./futureCommitments.service.js";
import { listActiveScenarioIdsForAccount } from "./scenarios.service.js";

export const defaultProjectionWindowDays = 30;
export const maxProjectionWindowDays = 730;
export const normalizeProjectionWindowDays = (windowDays: number | undefined) => {
  if (!Number.isFinite(windowDays)) return defaultProjectionWindowDays;
  const normalized = Math.trunc(Number(windowDays));
  if (normalized < 1) return defaultProjectionWindowDays;
  return Math.min(normalized, maxProjectionWindowDays);
};

export type ProjectionItemSource = "future_commitment" | "transfer" | "future_transaction" | "scenario_commitment";

export type ProjectionItem = {
  id: string;
  source: ProjectionItemSource;
  date: string;
  amount: string;
  runningBalance: string;
  name: string;
  payeeName: string | null;
  categoryName: string | null;
  status: string | null;
  transactionId: string | null;
  transferId: string | null;
  commitmentId: string | null;
  scenarioId: string | null;
};

export type AccountProjection = {
  account: {
    id: string;
    name: string;
    type: typeof accounts.$inferSelect.type;
  };
  asOfDate: string;
  windowDays: number;
  windowEndDate: string;
  projectionStartBalance: string;
  projectedEndingBalance: string;
  projectedLowBalance: string;
  projectedHighBalance: string;
  warningDates: string[];
  mode: "baseline" | "scenario";
  selectedScenarioIds: string[];
  items: ProjectionItem[];
};

type ProjectionInput = {
  windowDays?: number;
  asOfDate?: string;
  scenarioIds?: string[];
};

type RawProjectionItem = Omit<ProjectionItem, "amount" | "runningBalance"> & {
  amountCents: number;
};

const sourceOrder: Record<ProjectionItemSource, number> = {
  future_commitment: 1,
  transfer: 2,
  future_transaction: 3,
  scenario_commitment: 4
};

const assetAccountTypes = new Set<typeof accounts.$inferSelect.type>(["checking", "savings", "cash"]);
const liabilityAccountTypes = new Set<typeof accounts.$inferSelect.type>(["credit_card", "loan"]);
const transferFromAccounts = aliasedTable(accounts, "projection_transfer_from_accounts");
const transferToAccounts = aliasedTable(accounts, "projection_transfer_to_accounts");

const toNumber = (value: string | number | null | undefined) => Number(value ?? 0);
const toCents = (value: string | number | null | undefined) => Math.round(toNumber(value) * 100);
const toMoney = (cents: number) => (cents / 100).toFixed(2);

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const compareItems = (left: RawProjectionItem, right: RawProjectionItem) => {
  if (left.date !== right.date) return left.date.localeCompare(right.date);
  if (sourceOrder[left.source] !== sourceOrder[right.source]) {
    return sourceOrder[left.source] - sourceOrder[right.source];
  }
  const leftName = left.name || "";
  const rightName = right.name || "";
  if (leftName !== rightName) return leftName.localeCompare(rightName);
  return left.id.localeCompare(right.id);
};

const commitmentAccountFilter = (accountId: string) =>
  or(
    eq(futureCommitments.accountId, accountId),
    eq(futureCommitments.transferFromAccountId, accountId),
    eq(futureCommitments.transferToAccountId, accountId)
  );

const commitmentAmountCentsForAccount = (row: {
  kind: typeof futureCommitments.$inferSelect.kind;
  accountId: string | null;
  transferFromAccountId: string | null;
  transferFromAccountType: typeof accounts.$inferSelect.type | null;
  transferToAccountId: string | null;
  transferToAccountType: typeof accounts.$inferSelect.type | null;
  amount: string;
}, accountId: string) => {
  const amountCents = toCents(row.amount);
  if (row.kind === "transfer") {
    if (row.transferFromAccountId === accountId) return amountCents;
    if (row.transferToAccountId === accountId) return liabilityAccountTypes.has(row.transferToAccountType!) ? -Math.abs(amountCents) : Math.abs(amountCents);
  }
  return toCents(row.amount);
};

const commitmentName = (row: {
  kind: typeof futureCommitments.$inferSelect.kind;
  name: string;
  transferFromAccountName: string | null;
  transferToAccountName: string | null;
}) =>
  row.kind === "transfer"
    ? `${row.name}: ${row.transferFromAccountName ?? "From account"} → ${row.transferToAccountName ?? "To account"}`
    : row.name;

const getProjectionStartBalanceCents = async (accountId: string, statementChainBalance: string, asOfDate: string) => {
  const rows = await db
    .select({ amount: transactions.amount })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        isNull(transactions.statementId),
        ne(transactions.status, "void"),
        lte(transactions.date, asOfDate)
      )
    );

  return rows.reduce((total, row) => total + toCents(row.amount), toCents(statementChainBalance));
};

const getFutureTransactionItems = async (accountId: string, asOfDate: string, windowEndDate: string): Promise<RawProjectionItem[]> => {
  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
      status: transactions.status,
      description: transactions.description,
      payeeName: payees.name,
      categoryName: categories.name,
      transferId: transactions.transferId
    })
    .from(transactions)
    .leftJoin(payees, eq(transactions.payeeId, payees.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        eq(transactions.accountId, accountId),
        isNull(transactions.statementId),
        ne(transactions.status, "void"),
        gt(transactions.date, asOfDate),
        lte(transactions.date, windowEndDate)
      )
    )
    .orderBy(asc(transactions.date), asc(transactions.createdAt), asc(transactions.id));

  return rows.map((row) => ({
    id: row.id,
    source: row.transferId ? "transfer" : "future_transaction",
    date: row.date,
    amountCents: toCents(row.amount),
    name: row.description ?? (row.transferId ? "Transfer" : "Future transaction"),
    payeeName: row.payeeName,
    categoryName: row.categoryName,
    status: row.status,
    transactionId: row.id,
    transferId: row.transferId,
    commitmentId: null,
    scenarioId: null
  }));
};

const getFutureCommitmentItems = async (accountId: string, asOfDate: string, windowEndDate: string): Promise<RawProjectionItem[]> => {
  const rows = await db
    .select({
      id: futureCommitments.id,
      kind: futureCommitments.kind,
      name: futureCommitments.name,
      accountId: futureCommitments.accountId,
      transferFromAccountId: futureCommitments.transferFromAccountId,
      transferFromAccountName: transferFromAccounts.name,
      transferFromAccountType: transferFromAccounts.type,
      transferToAccountId: futureCommitments.transferToAccountId,
      transferToAccountName: transferToAccounts.name,
      transferToAccountType: transferToAccounts.type,
      amount: futureCommitments.amount,
      frequency: futureCommitments.frequency,
      nextDueDate: futureCommitments.nextDueDate,
      endDate: futureCommitments.endDate,
      payeeName: payees.name,
      categoryName: categories.name
    })
    .from(futureCommitments)
    .leftJoin(transferFromAccounts, eq(futureCommitments.transferFromAccountId, transferFromAccounts.id))
    .leftJoin(transferToAccounts, eq(futureCommitments.transferToAccountId, transferToAccounts.id))
    .leftJoin(payees, eq(futureCommitments.payeeId, payees.id))
    .leftJoin(categories, eq(futureCommitments.categoryId, categories.id))
    .where(
      and(
        commitmentAccountFilter(accountId),
        eq(futureCommitments.includeInBaseline, true),
        eq(futureCommitments.active, true),
        lte(futureCommitments.nextDueDate, windowEndDate)
      )
    );

  const items: RawProjectionItem[] = [];

  for (const row of rows) {
    let occurrenceDate = row.nextDueDate;
    while (occurrenceDate <= asOfDate) {
      const nextDueDate = advanceDueDate(occurrenceDate, row.frequency);
      if (!nextDueDate) {
        occurrenceDate = "";
        break;
      }
      occurrenceDate = nextDueDate;
    }

    while (occurrenceDate && occurrenceDate <= windowEndDate && (!row.endDate || occurrenceDate <= row.endDate)) {
      items.push({
        id: `${row.id}:${occurrenceDate}`,
        source: "future_commitment",
        date: occurrenceDate,
        amountCents: commitmentAmountCentsForAccount(row, accountId),
        name: commitmentName(row),
        payeeName: row.payeeName,
        categoryName: row.categoryName,
        status: null,
        transactionId: null,
        transferId: null,
        commitmentId: row.id,
        scenarioId: null
      });

      const nextDueDate = advanceDueDate(occurrenceDate, row.frequency);
      if (!nextDueDate) break;
      occurrenceDate = nextDueDate;
    }
  }

  return items;
};

const getScenarioCommitmentItems = async (accountId: string, asOfDate: string, windowEndDate: string, scenarioIds: string[]): Promise<RawProjectionItem[]> => {
  if (!scenarioIds.length) return [];

  const rows = await db
    .select({
      id: futureCommitments.id,
      scenarioId: futureCommitments.scenarioId,
      kind: futureCommitments.kind,
      name: futureCommitments.name,
      accountId: futureCommitments.accountId,
      transferFromAccountId: futureCommitments.transferFromAccountId,
      transferFromAccountName: transferFromAccounts.name,
      transferFromAccountType: transferFromAccounts.type,
      transferToAccountId: futureCommitments.transferToAccountId,
      transferToAccountName: transferToAccounts.name,
      transferToAccountType: transferToAccounts.type,
      amount: futureCommitments.amount,
      frequency: futureCommitments.frequency,
      nextDueDate: futureCommitments.nextDueDate,
      endDate: futureCommitments.endDate,
      payeeName: payees.name,
      categoryName: categories.name
    })
    .from(futureCommitments)
    .leftJoin(transferFromAccounts, eq(futureCommitments.transferFromAccountId, transferFromAccounts.id))
    .leftJoin(transferToAccounts, eq(futureCommitments.transferToAccountId, transferToAccounts.id))
    .leftJoin(payees, eq(futureCommitments.payeeId, payees.id))
    .leftJoin(categories, eq(futureCommitments.categoryId, categories.id))
    .where(
      and(
        commitmentAccountFilter(accountId),
        inArray(futureCommitments.scenarioId, scenarioIds),
        eq(futureCommitments.includeInBaseline, false),
        eq(futureCommitments.active, true),
        lte(futureCommitments.nextDueDate, windowEndDate)
      )
    );

  const items: RawProjectionItem[] = [];

  for (const row of rows) {
    let occurrenceDate = row.nextDueDate;
    while (occurrenceDate <= asOfDate) {
      const nextDueDate = advanceDueDate(occurrenceDate, row.frequency);
      if (!nextDueDate) {
        occurrenceDate = "";
        break;
      }
      occurrenceDate = nextDueDate;
    }

    while (occurrenceDate && occurrenceDate <= windowEndDate && (!row.endDate || occurrenceDate <= row.endDate)) {
      items.push({
        id: `${row.scenarioId}:${row.id}:${occurrenceDate}`,
        source: "scenario_commitment",
        date: occurrenceDate,
        amountCents: commitmentAmountCentsForAccount(row, accountId),
        name: commitmentName(row),
        payeeName: row.payeeName,
        categoryName: row.categoryName,
        status: null,
        transactionId: null,
        transferId: null,
        commitmentId: row.id,
        scenarioId: row.scenarioId
      });

      const nextDueDate = advanceDueDate(occurrenceDate, row.frequency);
      if (!nextDueDate) break;
      occurrenceDate = nextDueDate;
    }
  }

  return items;
};

export const getAccountProjection = async (accountId: string, input: ProjectionInput = {}): Promise<AccountProjection | null> => {
  const [account] = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      statementChainBalance: accounts.statementChainBalance
    })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);

  if (!account) return null;

  const asOfDate = input.asOfDate ?? isoToday();
  const windowDays = normalizeProjectionWindowDays(input.windowDays);
  const windowEndDate = addDays(asOfDate, windowDays);
  const selectedScenarioIds = await listActiveScenarioIdsForAccount(account.id, (input.scenarioIds ?? []).filter(Boolean));
  const projectionStartBalanceCents = await getProjectionStartBalanceCents(account.id, account.statementChainBalance, asOfDate);
  const baselineItems = [
    ...(await getFutureCommitmentItems(account.id, asOfDate, windowEndDate)),
    ...(await getFutureTransactionItems(account.id, asOfDate, windowEndDate))
  ];

  const scenarioItems = await getScenarioCommitmentItems(account.id, asOfDate, windowEndDate, selectedScenarioIds);
  const allItems = [...baselineItems, ...scenarioItems].sort(compareItems);

  let runningBalanceCents = projectionStartBalanceCents;
  let projectedLowBalanceCents = projectionStartBalanceCents;
  let projectedHighBalanceCents = projectionStartBalanceCents;
  const warningDates = new Set<string>();
  const warnOnNegativeBalance = assetAccountTypes.has(account.type);

  const projectedItems = allItems.map((item) => {
    runningBalanceCents += item.amountCents;
    projectedLowBalanceCents = Math.min(projectedLowBalanceCents, runningBalanceCents);
    projectedHighBalanceCents = Math.max(projectedHighBalanceCents, runningBalanceCents);
    if (warnOnNegativeBalance && runningBalanceCents < 0) warningDates.add(item.date);

    return {
      id: item.id,
      source: item.source,
      date: item.date,
      amount: toMoney(item.amountCents),
      runningBalance: toMoney(runningBalanceCents),
      name: item.name,
      payeeName: item.payeeName,
      categoryName: item.categoryName,
      status: item.status,
      transactionId: item.transactionId,
      transferId: item.transferId,
      commitmentId: item.commitmentId,
      scenarioId: item.scenarioId
    };
  });

  return {
    account: {
      id: account.id,
      name: account.name,
      type: account.type
    },
    asOfDate,
    windowDays,
    windowEndDate,
    projectionStartBalance: toMoney(projectionStartBalanceCents),
    projectedEndingBalance: toMoney(runningBalanceCents),
    projectedLowBalance: toMoney(projectedLowBalanceCents),
    projectedHighBalance: toMoney(projectedHighBalanceCents),
    warningDates: [...warningDates],
    mode: selectedScenarioIds.length ? "scenario" : "baseline",
    selectedScenarioIds,
    items: projectedItems
  };
};
