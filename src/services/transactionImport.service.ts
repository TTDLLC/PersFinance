import { parse } from "csv-parse/sync";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { categories, importBatches, payees, transactions } from "../db/schema.js";

const requiredHeaders = ["date", "amount"] as const;
const supportedHeaders = new Set([
  ...requiredHeaders,
  "payee",
  "description",
  "category",
  "memo",
  "reference"
]);

type CsvRow = Record<string, string>;

export type ImportPreviewRow = {
  id: string;
  rowNumber: number;
  date: string;
  payeeName: string;
  payeeId: string | null;
  createsPayee: boolean;
  amount: string;
  description: string | null;
  categoryName: string | null;
  categoryId: string | null;
  memo: string | null;
  reference: string | null;
  duplicate: boolean;
  errors: string[];
};

export type ImportPreview = {
  accountId: string;
  filename: string | null;
  rows: ImportPreviewRow[];
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  errorRows: number;
};

const normalizeName = (value: string) => value.trim().toLocaleLowerCase();
const optionalText = (value: string | undefined) => value?.trim() || null;
const duplicateKey = (date: string, amount: string, payeeName: string, description: string | null) =>
  `${date}\u0000${amount}\u0000${payeeName ? `payee:${normalizeName(payeeName)}` : `description:${normalizeName(description ?? "")}`}`;

const chunk = <T>(values: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
};

const WRITE_CHUNK_SIZE = 500;

export type ImportPhase = "batch creation" | "payee creation" | "transaction creation";

export class ImportConfirmationError extends Error {
  constructor(
    public readonly phase: ImportPhase,
    cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : "Unknown database error.", { cause });
    this.name = "ImportConfirmationError";
  }
}

const validCalendarDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};

const parseAmount = (value: string) => {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("(") && trimmed.endsWith(")");
  const normalized = trimmed.replace(/[,$()\s]/g, "");
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const numeric = Number(normalized) * (negative ? -1 : 1);
  if (!Number.isFinite(numeric) || numeric === 0) return null;
  return numeric.toFixed(2);
};

const parseCsv = (csvText: string) => {
  const records = parse(csvText, {
    bom: true,
    skip_empty_lines: true,
    trim: true
  }) as string[][];

  if (!records.length) throw new Error("CSV file is empty.");

  const headers = records[0].map((header) => normalizeName(header));
  const missing = requiredHeaders.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`CSV is missing required field(s): ${missing.map((header) => header[0].toUpperCase() + header.slice(1)).join(", ")}.`);

  const unsupported = headers.filter((header) => !supportedHeaders.has(header));
  if (unsupported.length) throw new Error(`CSV contains unsupported field(s): ${unsupported.join(", ")}.`);
  if (new Set(headers).size !== headers.length) throw new Error("CSV contains duplicate column names.");

  return records.slice(1).map((record) => {
    const row: CsvRow = {};
    headers.forEach((header, index) => {
      row[header] = record[index] ?? "";
    });
    return row;
  });
};

export const buildImportPreview = async (
  accountId: string,
  csvText: string,
  filename?: string | null
): Promise<ImportPreview> => {
  const csvRows = parseCsv(csvText);
  const [activePayees, activeCategories, existingTransactions] = await Promise.all([
    db.select({ id: payees.id, name: payees.name }).from(payees).where(eq(payees.active, true)).orderBy(asc(payees.name)),
    db.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.active, true)).orderBy(asc(categories.name)),
    db
      .select({
        date: transactions.date,
        amount: transactions.amount,
        payeeName: payees.name,
        description: transactions.description
      })
      .from(transactions)
      .leftJoin(payees, eq(transactions.payeeId, payees.id))
      .where(eq(transactions.accountId, accountId))
  ]);

  const payeesByName = new Map(activePayees.map((payee) => [normalizeName(payee.name), payee]));
  const categoriesByName = new Map(activeCategories.map((category) => [normalizeName(category.name), category]));
  const seenKeys = new Set(
    existingTransactions.map((row) =>
      duplicateKey(row.date, Number(row.amount).toFixed(2), row.payeeName ?? "", row.description)
    )
  );

  const rows = csvRows.map((csvRow, index): ImportPreviewRow => {
    const errors: string[] = [];
    const date = csvRow.date?.trim() ?? "";
    const payeeName = csvRow.payee?.trim() ?? "";
    const description = optionalText(csvRow.description);
    const amount = parseAmount(csvRow.amount ?? "");
    const categoryName = optionalText(csvRow.category);
    const matchedPayee = payeesByName.get(normalizeName(payeeName));
    const matchedCategory = categoryName ? categoriesByName.get(normalizeName(categoryName)) : undefined;

    if (!validCalendarDate(date)) errors.push("Date must be a valid YYYY-MM-DD date.");
    if (!payeeName && !description) errors.push("Payee or Description is required.");
    if (!amount) errors.push("Amount must be a non-zero number with no more than two decimal places.");
    if (categoryName && !matchedCategory) errors.push(`Category "${categoryName}" is not an active managed category.`);

    const key = date && amount && (payeeName || description)
      ? duplicateKey(date, amount, payeeName, description)
      : null;
    const duplicate = key && !errors.length ? seenKeys.has(key) : false;
    if (key && !errors.length) seenKeys.add(key);

    return {
      id: String(index),
      rowNumber: index + 2,
      date,
      payeeName,
      payeeId: matchedPayee?.id ?? null,
      createsPayee: Boolean(payeeName && !matchedPayee),
      amount: amount ?? csvRow.amount?.trim() ?? "",
      description,
      categoryName,
      categoryId: matchedCategory?.id ?? null,
      memo: optionalText(csvRow.memo),
      reference: optionalText(csvRow.reference),
      duplicate,
      errors
    };
  });

  return {
    accountId,
    filename: filename || null,
    rows,
    totalRows: rows.length,
    validRows: rows.filter((row) => !row.errors.length && !row.duplicate).length,
    duplicateRows: rows.filter((row) => row.duplicate).length,
    errorRows: rows.filter((row) => row.errors.length).length
  };
};

export const confirmImportPreview = async (preview: ImportPreview, includedDuplicateIds: string[] = []) => {
  const includedDuplicates = new Set(includedDuplicateIds);
  const selectedRows = preview.rows.filter(
    (row) => !row.errors.length && (!row.duplicate || includedDuplicates.has(row.id))
  );

  if (!selectedRows.length) throw new Error("There are no valid, selected rows to import.");

  let phase: ImportPhase = "batch creation";
  try {
    return await db.transaction(async (tx) => {
      const [batch] = await tx
        .insert(importBatches)
        .values({
          accountId: preview.accountId,
          filename: preview.filename,
          totalRows: preview.totalRows,
          importedRows: selectedRows.length,
          duplicateRows: preview.duplicateRows,
          errorRows: preview.errorRows
        })
        .returning();

      if (!batch) throw new Error("Could not create import batch.");

      const payeeIdsByName = new Map<string, string>();
      const existingPayeeIds = selectedRows.filter((row) => row.payeeId);
      for (const row of existingPayeeIds) payeeIdsByName.set(normalizeName(row.payeeName), row.payeeId as string);

      const missingPayeeNames = new Map<string, string>();
      for (const row of selectedRows) {
        if (row.payeeName && !row.payeeId) missingPayeeNames.set(normalizeName(row.payeeName), row.payeeName);
      }

      phase = "payee creation";
      for (const names of chunk([...missingPayeeNames.values()], WRITE_CHUNK_SIZE)) {
        const createdPayees = await tx
          .insert(payees)
          .values(names.map((name) => ({ name, source: "csv_import", createdByImportBatchId: batch.id })))
          .returning({ id: payees.id, name: payees.name });
        for (const created of createdPayees) payeeIdsByName.set(normalizeName(created.name), created.id);
      }

      phase = "transaction creation";
      for (const rows of chunk(selectedRows, WRITE_CHUNK_SIZE)) {
        await tx.insert(transactions).values(
          rows.map((row) => {
            const payeeId = row.payeeName ? payeeIdsByName.get(normalizeName(row.payeeName)) : null;
            if (row.payeeName && !payeeId) throw new Error(`Could not resolve payee "${row.payeeName}".`);
            return {
              accountId: preview.accountId,
              date: row.date,
              amount: row.amount,
              status: "cleared" as const,
              statementId: null,
              payeeId,
              description: row.description,
              categoryId: row.categoryId,
              notes: row.memo,
              reference: row.reference,
              importBatchId: batch.id
            };
          })
        );
      }

      return batch;
    });
  } catch (error) {
    if (error instanceof ImportConfirmationError) throw error;
    throw new ImportConfirmationError(phase, error);
  }
};

export const listImportBatches = async (accountId: string) =>
  db
    .select({
      id: importBatches.id,
      filename: importBatches.filename,
      totalRows: importBatches.totalRows,
      importedRows: importBatches.importedRows,
      duplicateRows: importBatches.duplicateRows,
      errorRows: importBatches.errorRows,
      createdAt: importBatches.createdAt,
      reconciledTransactions: sql<number>`count(${transactions.id}) filter (where ${transactions.statementId} is not null)::int`
    })
    .from(importBatches)
    .leftJoin(transactions, eq(transactions.importBatchId, importBatches.id))
    .where(eq(importBatches.accountId, accountId))
    .groupBy(importBatches.id)
    .orderBy(sql`${importBatches.createdAt} desc`);

export const rollbackImportBatch = async (accountId: string, batchId: string) =>
  db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(importBatches)
      .where(and(eq(importBatches.id, batchId), eq(importBatches.accountId, accountId)))
      .limit(1);
    if (!batch) throw new Error("Import batch not found.");

    const [reconciled] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.importBatchId, batch.id), isNotNull(transactions.statementId)))
      .limit(1);
    if (reconciled) throw new Error("This import batch cannot be deleted because one or more transactions have been reconciled.");

    const createdPayees = await tx
      .select({ id: payees.id })
      .from(payees)
      .where(eq(payees.createdByImportBatchId, batch.id));

    await tx.delete(transactions).where(eq(transactions.importBatchId, batch.id));

    if (createdPayees.length) {
      const payeeIds = createdPayees.map((payee) => payee.id);
      const usedPayees = await tx
        .select({ payeeId: transactions.payeeId })
        .from(transactions)
        .where(inArray(transactions.payeeId, payeeIds));
      const usedPayeeIds = new Set(usedPayees.map((row) => row.payeeId));
      const safePayeeIds = payeeIds.filter((id) => !usedPayeeIds.has(id));
      if (safePayeeIds.length) await tx.delete(payees).where(inArray(payees.id, safePayeeIds));
    }

    await tx.delete(importBatches).where(eq(importBatches.id, batch.id));
    return batch;
  });
