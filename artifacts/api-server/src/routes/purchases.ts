import { Router, type IRouter } from "express";
import { eq, and, gte, lte, asc, desc, sql } from "drizzle-orm";
import { db, purchasesTable, purchaseLinesTable, vendorsTable, ingredientsTable, vendorLedgerTable, pettyCashLedgerTable, systemConfigTable, expensesTable } from "@workspace/db";
import { ListPurchasesResponse, CreatePurchaseBody, GetPurchaseParams, GetPurchaseResponse } from "@workspace/api-zod";
import { authMiddleware, adminOnly, requirePermission } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { generateCode } from "../lib/codeGenerator";
import { validateNotFutureDate } from "../lib/dateValidation";
import { createSignedReadUrl, deleteFileFromS3, sanitizeFileName, uploadFileToS3, type StoredS3Attachment } from "../lib/s3Storage";
import PDFDocument from "pdfkit";
import multer from "multer";
import path from "path";
import fs from "fs";
import type { Request, Response, NextFunction } from "express";

function round2(n: number): number {
  return Math.round((n || 0) * 100) / 100;
}

const router: IRouter = Router();
const PURCHASE_BILL_DIR = path.join(process.cwd(), "uploads", "purchase-bills");
const MAX_BILL_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const ALLOWED_BILL_ATTACHMENT_TYPES = ["image/jpeg", "image/jpg", "image/png", "application/pdf"] as const;

const purchaseBillUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BILL_ATTACHMENT_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_BILL_ATTACHMENT_TYPES.includes(file.mimetype as (typeof ALLOWED_BILL_ATTACHMENT_TYPES)[number])) {
      cb(null, true);
      return;
    }
    cb(new Error("Unsupported bill attachment format. Supported formats: JPG, JPEG, PNG, PDF."));
  },
});

function purchaseBillUploadMiddleware(req: Request, res: Response, next: NextFunction): void {
  purchaseBillUpload.single("billAttachment")(req, res, (err) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ error: "Bill attachment must be 10 MB or smaller." });
      return;
    }
    if (err instanceof multer.MulterError) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(400).json({ error: "Unsupported bill attachment format. Supported formats: JPG, JPEG, PNG, PDF." });
  });
}

type PurchaseAttachmentMetadata = {
  billAttachmentUrl: string | null;
  billAttachmentName: string | null;
  billAttachmentType: string | null;
};

type ParsedStoredBillAttachment =
  | ({ kind: "s3" } & StoredS3Attachment)
  | { kind: "legacy-local"; path: string; name: string; type: string | null };

function billAttachmentTypeFromName(name: string | null | undefined): string | null {
  const lower = String(name || "").toLowerCase();
  if (!lower) return null;
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return null;
}

function parseStoredBillAttachment(billAttachment: string | null | undefined): ParsedStoredBillAttachment | null {
  if (!billAttachment) {
    return null;
  }
  const trimmed = String(billAttachment).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<StoredS3Attachment>;
      if (parsed?.storage === "s3" && parsed.key && parsed.bucket) {
        return {
          kind: "s3",
          storage: "s3",
          bucket: String(parsed.bucket),
          key: String(parsed.key),
          name: String(parsed.name || path.basename(String(parsed.key))),
          type: String(parsed.type || billAttachmentTypeFromName(String(parsed.name || parsed.key)) || "application/octet-stream"),
          size: Number(parsed.size || 0),
        };
      }
    } catch {
      // fall through to legacy local attachment handling
    }
  }
  const billAttachmentName = decodeURIComponent(path.basename(trimmed));
  return {
    kind: "legacy-local",
    path: trimmed,
    name: billAttachmentName,
    type: billAttachmentTypeFromName(billAttachmentName),
  };
}

async function serializeBillAttachment(billAttachment: string | null | undefined): Promise<PurchaseAttachmentMetadata> {
  const parsed = parseStoredBillAttachment(billAttachment);
  if (!parsed) {
    return {
      billAttachmentUrl: null,
      billAttachmentName: null,
      billAttachmentType: null,
    };
  }
  if (parsed.kind === "s3") {
    return {
      billAttachmentUrl: await createSignedReadUrl(parsed.key, parsed.name, parsed.type),
      billAttachmentName: parsed.name,
      billAttachmentType: parsed.type,
    };
  }
  return {
    billAttachmentUrl: parsed.path,
    billAttachmentName: parsed.name,
    billAttachmentType: parsed.type,
  };
}

async function uploadPurchaseBillAttachment(input: {
  file: Express.Multer.File | undefined;
  tenantSchemaName: string | null;
  purchaseId: number;
}): Promise<string | null> {
  if (!input.file) return null;
  const tenantKey = sanitizeFileName(input.tenantSchemaName || "public");
  const objectKey = [
    "purchase-bills",
    tenantKey,
    String(input.purchaseId),
    `${Date.now()}-${sanitizeFileName(input.file.originalname)}`,
  ].join("/");
  const stored = await uploadFileToS3({
    key: objectKey,
    body: input.file.buffer,
    contentType: input.file.mimetype,
    originalName: input.file.originalname,
    contentLength: input.file.size,
  });
  return JSON.stringify(stored);
}

async function deletePurchaseBillFile(billAttachment: string | null | undefined): Promise<void> {
  const parsed = parseStoredBillAttachment(billAttachment);
  if (!parsed) return;
  if (parsed.kind === "s3") {
    await deleteFileFromS3(parsed.key);
    return;
  }
  const diskPath = path.join(PURCHASE_BILL_DIR, path.basename(parsed.path));
  try {
    fs.unlinkSync(diskPath);
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function parseBooleanLike(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

function parsePurchaseRequestBody(req: Request) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  const rawBody = contentType.includes("multipart/form-data")
    ? (() => {
        if (typeof req.body?.payload !== "string") return null;
        try {
          return JSON.parse(req.body.payload);
        } catch {
          return undefined;
        }
      })()
    : req.body;

  if (rawBody === null) {
    return {
      success: false as const,
      errorMessage: "Multipart purchase requests must include a JSON payload field.",
    };
  }
  if (typeof rawBody === "undefined") {
    return {
      success: false as const,
      errorMessage: "Invalid purchase payload JSON.",
    };
  }

  const parsed = CreatePurchaseBody.safeParse(rawBody);
  if (!parsed.success) {
    return {
      success: false as const,
      errorMessage: parsed.error.message,
    };
  }

  const removeBillAttachment = parseBooleanLike(req.body?.removeBillAttachment ?? rawBody?.removeBillAttachment);
  return {
    success: true as const,
    data: parsed.data,
    removeBillAttachment,
  };
}

function normalizeTenantSchemaName(value: string | null | undefined): string | null {
  const trimmed = String(value || "").trim();
  return trimmed ? trimmed : null;
}

function fmtMoney(n: number): string {
  return `₹${(Math.round((n || 0) * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDateLabel(s?: string | null): string {
  if (!s) return "-";
  const d = new Date(s + (s.length === 10 ? "T00:00:00Z" : ""));
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "2-digit" });
}

async function recalculateVendorLedger(tx: any, vendorId: number): Promise<void> {
  const entries = await tx
    .select({
      id: vendorLedgerTable.id,
      debit: vendorLedgerTable.debit,
      credit: vendorLedgerTable.credit,
    })
    .from(vendorLedgerTable)
    .where(eq(vendorLedgerTable.vendorId, vendorId))
    .orderBy(asc(vendorLedgerTable.transactionDate), asc(vendorLedgerTable.id));

  let runningBalance = 0;
  for (const entry of entries) {
    runningBalance = round2(runningBalance + (entry.debit || 0) - (entry.credit || 0));
    await tx
      .update(vendorLedgerTable)
      .set({ runningBalance })
      .where(eq(vendorLedgerTable.id, entry.id));
  }
}

async function removePurchaseStockImpact(tx: any, purchaseId: number): Promise<typeof purchaseLinesTable.$inferSelect[]> {
  const existingLines = await tx.select().from(purchaseLinesTable).where(eq(purchaseLinesTable.purchaseId, purchaseId));
  for (const line of existingLines) {
    const [ing] = await tx.select().from(ingredientsTable).where(eq(ingredientsTable.id, line.ingredientId));
    if (!ing) continue;
    const newStock = Math.max(0, (ing.currentStock || 0) - (line.quantity || 0));
    await tx.update(ingredientsTable).set({ currentStock: newStock }).where(eq(ingredientsTable.id, line.ingredientId));
  }
  return existingLines;
}

async function applyPurchaseLines(
  tx: any,
  purchaseId: number,
  lines: Array<{ ingredientId: number; quantity: number; purchaseUom?: string; unitRate: number; taxPercent?: number; expiryDate?: string | null }>,
): Promise<{ subtotal: number; taxAmount: number; totalAmount: number }> {
  let subtotal = 0;
  let taxAmount = 0;
  let totalAmount = 0;
  for (const line of lines) {
    const taxPercent = line.taxPercent ?? 0;
    const quantity = line.quantity;
    const unitRate = line.unitRate;
    const baseAmount = round2(quantity * unitRate);
    const lineTax = round2(baseAmount * (taxPercent / 100));
    const lineTotal = round2(baseAmount + lineTax);
    subtotal = round2(subtotal + baseAmount);
    taxAmount = round2(taxAmount + lineTax);
    totalAmount = round2(totalAmount + lineTotal);

    await tx.insert(purchaseLinesTable).values({
      purchaseId,
      ingredientId: line.ingredientId,
      quantity,
      purchaseUom: line.purchaseUom ?? "unit",
      unitRate,
      taxPercent,
      lineTotal,
      expiryDate: line.expiryDate || null,
    });

    const [ing] = await tx.select().from(ingredientsTable).where(eq(ingredientsTable.id, line.ingredientId));
    if (!ing) continue;
    const newStock = (ing.currentStock || 0) + quantity;
    const oldTotal = (ing.weightedAvgCost || 0) * (ing.currentStock || 0);
    const newTotal = oldTotal + unitRate * quantity;
    const newAvg = newStock > 0 ? round2(newTotal / newStock) : unitRate;
    await tx.update(ingredientsTable).set({
      currentStock: newStock,
      latestCost: unitRate,
      weightedAvgCost: newAvg,
      }).where(eq(ingredientsTable.id, line.ingredientId));
  }
  return { subtotal, taxAmount, totalAmount };
}

function normalizePurchasePaymentStatus(status?: string | null): "fully_paid" | "unpaid" {
  const value = String(status || "").trim().toLowerCase();
  return value === "paid" || value === "fully_paid" ? "fully_paid" : "unpaid";
}

async function getPettyCashOpeningBalance(tx: any): Promise<number> {
  const [config] = await tx.select().from(systemConfigTable);
  return Number(config?.pettyCashOpeningBalance || 0);
}

async function getPettyCashBalanceInTx(tx: any): Promise<number> {
  const opening = await getPettyCashOpeningBalance(tx);
  const [agg] = await tx.select({
    sum: sql<number>`COALESCE(
      SUM(CASE WHEN transaction_type = 'receipt'    THEN amount ELSE 0 END) -
      SUM(CASE WHEN transaction_type = 'expense'    THEN amount ELSE 0 END) +
      SUM(CASE WHEN transaction_type = 'adjustment' THEN amount ELSE 0 END), 0)`
  }).from(pettyCashLedgerTable);
  return round2(opening + Number(agg?.sum || 0));
}

async function recalculatePettyCashRunningBalances(tx: any): Promise<void> {
  const opening = await getPettyCashOpeningBalance(tx);
  const rows = await tx.select({
    id: pettyCashLedgerTable.id,
    amount: pettyCashLedgerTable.amount,
    transactionType: pettyCashLedgerTable.transactionType,
  })
    .from(pettyCashLedgerTable)
    .orderBy(asc(pettyCashLedgerTable.transactionDate), asc(pettyCashLedgerTable.id));

  let runningBalance = opening;
  for (const row of rows) {
    if (row.transactionType === "receipt") runningBalance = round2(runningBalance + Number(row.amount || 0));
    else if (row.transactionType === "expense") runningBalance = round2(runningBalance - Number(row.amount || 0));
    else if (row.transactionType === "adjustment") runningBalance = round2(runningBalance + Number(row.amount || 0));
    await tx.update(pettyCashLedgerTable).set({ runningBalance }).where(eq(pettyCashLedgerTable.id, row.id));
  }
}

async function deletePurchasePettyCashArtifacts(tx: any, purchase: typeof purchasesTable.$inferSelect): Promise<void> {
  if (purchase.linkedExpenseId) {
    await tx.delete(pettyCashLedgerTable).where(eq(pettyCashLedgerTable.linkedExpenseId, purchase.linkedExpenseId));
    await tx.delete(expensesTable).where(eq(expensesTable.id, purchase.linkedExpenseId));
    await recalculatePettyCashRunningBalances(tx);
    return;
  }

  const legacyRows = await tx.select({ id: pettyCashLedgerTable.id })
    .from(pettyCashLedgerTable)
    .where(and(
      eq(pettyCashLedgerTable.transactionType, "expense"),
      sql`lower(${pettyCashLedgerTable.category}) = 'purchase'`,
      eq(pettyCashLedgerTable.transactionDate, purchase.purchaseDate),
      eq(pettyCashLedgerTable.amount, round2(Number(purchase.totalAmount || 0))),
      sql`${pettyCashLedgerTable.description} like ${`Purchase ${purchase.purchaseNumber}%`}`,
    ))
    .orderBy(pettyCashLedgerTable.id);

  const legacyId = legacyRows.at(-1)?.id;
  if (legacyId) {
    await tx.delete(pettyCashLedgerTable).where(eq(pettyCashLedgerTable.id, legacyId));
    await recalculatePettyCashRunningBalances(tx);
  }
}

async function createPurchasePettyCashArtifacts(tx: any, opts: {
  purchase: typeof purchasesTable.$inferSelect;
  vendorName: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  purchaseDate: string;
  invoiceNumber?: string | null;
  userId: number | null;
}): Promise<number> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(91234567)`);

  const balance = await getPettyCashBalanceInTx(tx);
  if (balance + 0.01 < opts.totalAmount) {
    throw Object.assign(
      new Error(`Insufficient petty cash balance. Available: ₹${balance.toFixed(2)}, Required: ₹${opts.totalAmount.toFixed(2)}`),
      { httpStatus: 400 },
    );
  }

  const expenseNumber = await generateCode("EXP", "expenses");
  const [expense] = await tx.insert(expensesTable).values({
    expenseNumber,
    expenseDate: opts.purchaseDate,
    vendorId: opts.purchase.vendorId,
    amount: opts.subtotal,
    taxAmount: opts.taxAmount,
    totalAmount: opts.totalAmount,
    paymentMode: "Petty Cash",
    paidBy: opts.vendorName || null,
    description: `Purchase ${opts.purchase.purchaseNumber}`,
    costType: "variable",
    recurring: false,
    createdBy: opts.userId,
  }).returning();

  const [ledger] = await tx.insert(pettyCashLedgerTable).values({
    transactionDate: opts.purchaseDate,
    transactionType: "expense",
    amount: opts.totalAmount,
    method: "petty cash",
    counterpartyName: opts.vendorName || null,
    category: "Purchase",
    linkedExpenseId: expense.id,
    description: `Purchase ${opts.purchase.purchaseNumber}${opts.invoiceNumber ? ` - Invoice ${opts.invoiceNumber}` : ""}`,
    runningBalance: round2(balance - opts.totalAmount),
    approvalStatus: "approved",
    createdBy: opts.userId,
  }).returning();

  await tx.update(expensesTable).set({ linkedPettyCashId: ledger.id }).where(eq(expensesTable.id, expense.id));
  await tx.update(purchasesTable).set({ linkedExpenseId: expense.id }).where(eq(purchasesTable.id, opts.purchase.id));
  await recalculatePettyCashRunningBalances(tx);
  return expense.id;
}

async function applyTenantSearchPath(tx: any, tenantSchemaName: string | null) {
  if (!tenantSchemaName) return;
  await tx.execute(sql`select set_config('search_path', ${`"${tenantSchemaName}", public`}, false)`);
}

async function rebuildVendorLedgerForPurchase(tx: any, opts: {
  purchaseId: number;
  vendorId: number;
  purchaseDate: string;
  purchaseNumber: string;
  invoiceNumber?: string | null;
  totalAmount: number;
  paymentMode: string | null;
  paymentStatus: "fully_paid" | "unpaid";
}): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(57000000, ${opts.vendorId})`);
  await tx.delete(vendorLedgerTable).where(and(
    eq(vendorLedgerTable.referenceType, "purchase"),
    eq(vendorLedgerTable.referenceId, opts.purchaseId),
  ));

  const lastLedger = await tx.select().from(vendorLedgerTable)
    .where(eq(vendorLedgerTable.vendorId, opts.vendorId))
    .orderBy(desc(vendorLedgerTable.transactionDate), desc(vendorLedgerTable.id))
    .limit(1);
  let prevBalance = lastLedger.length > 0 ? lastLedger[0].runningBalance : 0;

  await tx.insert(vendorLedgerTable).values({
    vendorId: opts.vendorId,
    transactionDate: opts.purchaseDate,
    transactionType: "purchase",
    referenceType: "purchase",
    referenceId: opts.purchaseId,
    debit: opts.totalAmount,
    credit: 0,
    runningBalance: round2(prevBalance + opts.totalAmount),
    description: `Purchase ${opts.purchaseNumber} - ${opts.invoiceNumber || "No invoice"}`,
  });
  prevBalance = round2(prevBalance + opts.totalAmount);

  if (opts.paymentStatus === "fully_paid") {
    await tx.insert(vendorLedgerTable).values({
      vendorId: opts.vendorId,
      transactionDate: opts.purchaseDate,
      transactionType: "payment",
      referenceType: "purchase",
      referenceId: opts.purchaseId,
      debit: 0,
      credit: opts.totalAmount,
      runningBalance: round2(prevBalance - opts.totalAmount),
      description: `Paid on creation via ${opts.paymentMode || "cash"}`,
    });
  }
}

function generateBillPdf(data: {
  purchase: any;
  vendor: any;
  lines: any[];
  totals: { subtotal: number; tax: number; total: number; paid: number; pending: number };
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const { purchase, vendor, lines, totals } = data;
    const pageW = doc.page.width - 80;

    // Header
    doc.fontSize(18).fillColor("#6750A4").font("Helvetica-Bold")
      .text("Epic Poetry Cafe", 40, 40);
    doc.fontSize(9).fillColor("#666").font("Helvetica")
      .text("Vendor Bill / Purchase Invoice", 40, 62);

    // Title block (right)
    doc.fontSize(14).fillColor("#222").font("Helvetica-Bold")
      .text(`Bill ${purchase.purchaseNumber}`, 40, 40, { width: pageW, align: "right" });
    doc.fontSize(9).fillColor("#666").font("Helvetica")
      .text(`Date: ${fmtDateLabel(purchase.purchaseDate)}`, 40, 60, { width: pageW, align: "right" });
    if (purchase.invoiceNumber) {
      doc.text(`Vendor Invoice #: ${purchase.invoiceNumber}`, 40, 74, { width: pageW, align: "right" });
    }

    let y = 100;
    doc.moveTo(40, y).lineTo(40 + pageW, y).strokeColor("#6750A4").lineWidth(1).stroke();
    y += 12;

    // Vendor info
    doc.fontSize(10).fillColor("#222").font("Helvetica-Bold").text("Vendor", 40, y);
    y += 14;
    doc.fontSize(10).fillColor("#000").font("Helvetica-Bold").text(vendor?.name || "—", 40, y);
    y += 13;
    doc.font("Helvetica").fontSize(9).fillColor("#444");
    if (vendor?.contactPerson) { doc.text(`Contact: ${vendor.contactPerson}`, 40, y); y += 12; }
    if (vendor?.mobile) { doc.text(`Mobile: ${vendor.mobile}`, 40, y); y += 12; }
    if (vendor?.email) { doc.text(`Email: ${vendor.email}`, 40, y); y += 12; }
    if (vendor?.address) { doc.text(`Address: ${vendor.address}`, 40, y, { width: pageW * 0.7 }); y += 12; }
    if (vendor?.gstNumber) { doc.text(`GST: ${vendor.gstNumber}`, 40, y); y += 12; }

    y += 8;

    // Bill meta
    const metaPairs: Array<[string, string]> = [
      ["Payment Mode", String(purchase.paymentMode || "-")],
      ["Payment Status", String(purchase.paymentStatus || "-").replace(/_/g, " ")],
      ["Due Date", fmtDateLabel(purchase.dueDate)],
    ];
    doc.fontSize(9).fillColor("#444");
    metaPairs.forEach(([label, value]) => {
      doc.font("Helvetica-Bold").text(`${label}: `, 40, y, { continued: true });
      doc.font("Helvetica").text(value);
      y += 12;
    });

    y += 8;

    // Items table
    const cols = [
      { key: "sn", label: "#", w: 24, align: "left" as const },
      { key: "name", label: "Item", w: pageW - 24 - 50 - 70 - 50 - 70, align: "left" as const },
      { key: "qty", label: "Qty", w: 50, align: "right" as const },
      { key: "rate", label: "Rate", w: 70, align: "right" as const },
      { key: "tax", label: "Tax %", w: 50, align: "right" as const },
      { key: "total", label: "Amount", w: 70, align: "right" as const },
    ];
    const rowH = 18;
    const drawHeader = () => {
      doc.rect(40, y, pageW, rowH).fill("#6750A4");
      let x = 40;
      doc.fillColor("#fff").font("Helvetica-Bold").fontSize(9);
      cols.forEach((c) => {
        doc.text(c.label, x + 4, y + 5, { width: c.w - 8, align: c.align, lineBreak: false });
        x += c.w;
      });
      y += rowH;
      doc.fillColor("#000").font("Helvetica");
    };
    drawHeader();

    lines.forEach((l: any, idx: number) => {
      if (y > doc.page.height - 140) {
        doc.addPage({ size: "A4", margin: 40 });
        y = 40;
        drawHeader();
      }
      const rowVals: Record<string, string> = {
        sn: String(idx + 1),
        name: `${l.ingredientName || "—"}${l.purchaseUom ? ` (${l.purchaseUom})` : ""}`,
        qty: Number(l.quantity || 0).toLocaleString("en-IN"),
        rate: fmtMoney(Number(l.unitRate || 0)),
        tax: `${Number(l.taxPercent || 0)}%`,
        total: fmtMoney(Number(l.lineTotal || 0)),
      };
      let x = 40;
      doc.fontSize(9).fillColor("#000").font("Helvetica");
      cols.forEach((c) => {
        doc.text(rowVals[c.key], x + 4, y + 5, { width: c.w - 8, align: c.align, lineBreak: false, ellipsis: true });
        x += c.w;
      });
      doc.strokeColor("#e6e6e6").lineWidth(0.5).moveTo(40, y + rowH).lineTo(40 + pageW, y + rowH).stroke();
      y += rowH;
    });

    y += 12;
    if (y > doc.page.height - 140) { doc.addPage({ size: "A4", margin: 40 }); y = 40; }

    // Totals box
    const tx = 40 + pageW - 220;
    const tw = 220;
    const drawTotalRow = (label: string, value: string, opts?: { bold?: boolean; color?: string }) => {
      doc.fontSize(opts?.bold ? 11 : 10).fillColor(opts?.color || "#222").font(opts?.bold ? "Helvetica-Bold" : "Helvetica");
      doc.text(label, tx, y, { width: tw - 90, align: "left" });
      doc.text(value, tx + tw - 90, y, { width: 90, align: "right" });
      y += opts?.bold ? 16 : 14;
    };
    drawTotalRow("Subtotal", fmtMoney(totals.subtotal));
    drawTotalRow("Tax", fmtMoney(totals.tax));
    doc.strokeColor("#cccccc").lineWidth(0.5).moveTo(tx, y).lineTo(tx + tw, y).stroke();
    y += 4;
    drawTotalRow("Grand Total", fmtMoney(totals.total), { bold: true, color: "#6750A4" });
    drawTotalRow("Paid", fmtMoney(totals.paid), { color: "#059669" });
    drawTotalRow("Pending", fmtMoney(totals.pending), { color: totals.pending > 0 ? "#d97706" : "#059669" });

    if (purchase.notes || purchase.remarks) {
      y += 12;
      doc.fontSize(9).fillColor("#444").font("Helvetica-Bold").text("Remarks", 40, y);
      y += 12;
      doc.font("Helvetica").fillColor("#222").text(String(purchase.notes || purchase.remarks || ""), 40, y, { width: pageW });
    }

    // Footer
    const footerY = doc.page.height - 40;
    doc.fontSize(8).fillColor("#999").font("Helvetica")
      .text(`Generated ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`, 40, footerY, { width: pageW, align: "center" });

    doc.end();
  });
}

router.get("/purchases", async (req, res): Promise<void> => {
  const conditions = [];
  if (req.query.fromDate) conditions.push(gte(purchasesTable.purchaseDate, req.query.fromDate as string));
  if (req.query.toDate) conditions.push(lte(purchasesTable.purchaseDate, req.query.toDate as string));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const query = db
    .select({
      id: purchasesTable.id,
      purchaseNumber: purchasesTable.purchaseNumber,
      purchaseDate: purchasesTable.purchaseDate,
      vendorId: purchasesTable.vendorId,
      vendorName: vendorsTable.name,
      invoiceNumber: purchasesTable.invoiceNumber,
      paymentMode: purchasesTable.paymentMode,
      paymentStatus: purchasesTable.paymentStatus,
      totalAmount: purchasesTable.totalAmount,
      paidAmount: purchasesTable.paidAmount,
      pendingAmount: purchasesTable.pendingAmount,
      billAttachment: purchasesTable.billAttachment,
      dueDate: purchasesTable.dueDate,
      vendorInvoiceNumber: purchasesTable.vendorInvoiceNumber,
      notes: purchasesTable.notes,
      verified: purchasesTable.verified,
      verifiedBy: purchasesTable.verifiedBy,
      verifiedAt: purchasesTable.verifiedAt,
      createdAt: purchasesTable.createdAt,
    })
    .from(purchasesTable)
    .leftJoin(vendorsTable, eq(purchasesTable.vendorId, vendorsTable.id));

  if (req.query.vendorId) conditions.push(eq(purchasesTable.vendorId, Number(req.query.vendorId)));
  if (req.query.paymentStatus) conditions.push(eq(purchasesTable.paymentStatus, req.query.paymentStatus as string));

  const finalWhere = conditions.length > 0 ? and(...conditions) : undefined;
  const purchases = finalWhere
    ? await query.where(finalWhere).orderBy(purchasesTable.createdAt)
    : await query.orderBy(purchasesTable.createdAt);
  const serializedPurchases = await Promise.all(purchases.map(async (purchase) => ({
    ...purchase,
    ...(await serializeBillAttachment(purchase.billAttachment)),
  })));
  res.json(ListPurchasesResponse.parse(serializedPurchases));
});

router.post("/purchases", authMiddleware, requirePermission("purchases.create"), purchaseBillUploadMiddleware, async (req, res): Promise<void> => {
  const parsed = parsePurchaseRequestBody(req);
  if (!parsed.success) { res.status(400).json({ error: parsed.errorMessage }); return; }
  const dateErr = validateNotFutureDate(parsed.data.purchaseDate, "Purchase date");
  if (dateErr) { res.status(400).json({ error: dateErr }); return; }

  const isPaid = parsed.data.paymentStatus === "paid";
  const paymentMode = parsed.data.paymentMode || (isPaid ? "cash" : null);
  const isPettyCash = isPaid && paymentMode === "petty_cash";
  const uploadedFile = req.file as Express.Multer.File | undefined;
  const tenantSchemaName = normalizeTenantSchemaName((req as any).tenantSchemaName);
  const userId = (req as any).userId || null;

  let createdPurchase: typeof purchasesTable.$inferSelect;
  let computedTotal = 0;
  let computedSubtotal = 0;
  let computedTaxAmount = 0;
  let vendorName = "";
  let uploadedBillAttachment: string | null = null;

  try {
    const result = await db.transaction(async (tx) => {
      await applyTenantSearchPath(tx, tenantSchemaName);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(56000000, ${parsed.data.vendorId})`);
      const purchaseNumber = await generateCode("PUR", "purchases", tx);
      const [purchase] = await tx.insert(purchasesTable).values({
        purchaseNumber,
        purchaseDate: parsed.data.purchaseDate,
        vendorId: parsed.data.vendorId,
        invoiceNumber: parsed.data.invoiceNumber,
        vendorInvoiceNumber: parsed.data.invoiceNumber || undefined,
        dueDate: parsed.data.dueDate || undefined,
        paymentMode,
        paymentStatus: isPaid ? "fully_paid" : "unpaid",
        notes: parsed.data.notes,
        billAttachment: null,
        totalAmount: 0,
      }).returning();

      const nextBillAttachment = await uploadPurchaseBillAttachment({
        file: uploadedFile,
        tenantSchemaName,
        purchaseId: purchase.id,
      });
      uploadedBillAttachment = nextBillAttachment;
      if (nextBillAttachment) {
        await tx.update(purchasesTable).set({ billAttachment: nextBillAttachment }).where(eq(purchasesTable.id, purchase.id));
      }

      const lineTotals = await applyPurchaseLines(tx, purchase.id, parsed.data.lines as any);
      const totalAmount = round2(lineTotals.totalAmount);
      const finalStatus = isPaid ? "fully_paid" : "unpaid";
      await tx.update(purchasesTable).set({
        totalAmount,
        grossAmount: lineTotals.subtotal,
        taxAmount: lineTotals.taxAmount,
        pendingAmount: finalStatus === "fully_paid" ? 0 : totalAmount,
        paidAmount: finalStatus === "fully_paid" ? totalAmount : 0,
        paymentStatus: finalStatus,
        lastPaymentDate: finalStatus === "fully_paid" ? parsed.data.purchaseDate : undefined,
      }).where(eq(purchasesTable.id, purchase.id));

      const [vendor] = await tx.select().from(vendorsTable).where(eq(vendorsTable.id, parsed.data.vendorId));
      const resolvedVendorName = vendor?.name ?? "";

      await rebuildVendorLedgerForPurchase(tx, {
        purchaseId: purchase.id,
        vendorId: parsed.data.vendorId,
        purchaseDate: parsed.data.purchaseDate,
        purchaseNumber,
        invoiceNumber: parsed.data.invoiceNumber,
        totalAmount,
        paymentMode,
        paymentStatus: finalStatus,
      });
      await recalculateVendorLedger(tx, parsed.data.vendorId);

      if (isPettyCash) {
        await createPurchasePettyCashArtifacts(tx, {
          purchase,
          vendorName: resolvedVendorName || `vendor #${parsed.data.vendorId}`,
          subtotal: lineTotals.subtotal,
          taxAmount: lineTotals.taxAmount,
          totalAmount,
          purchaseDate: parsed.data.purchaseDate,
          invoiceNumber: parsed.data.invoiceNumber,
          userId,
        });
      }

      const [freshPurchase] = await tx.select().from(purchasesTable).where(eq(purchasesTable.id, purchase.id)).limit(1);
      return {
        purchase: freshPurchase ?? purchase,
        purchaseNumber,
        subtotal: lineTotals.subtotal,
        taxAmount: lineTotals.taxAmount,
        totalAmount,
        vendorName: resolvedVendorName,
      };
    });
    createdPurchase = result.purchase;
    const purchaseNumber = result.purchaseNumber;
    computedSubtotal = result.subtotal;
    computedTaxAmount = result.taxAmount;
    computedTotal = result.totalAmount;
    vendorName = result.vendorName;
    await createAuditLog("purchases", createdPurchase.id, "create", null, { purchaseNumber, totalAmount: computedTotal, paymentMode, isPaid });
  } catch (e: any) {
    if (uploadedBillAttachment) {
      await deletePurchaseBillFile(uploadedBillAttachment).catch(() => undefined);
    }
    const status = e?.httpStatus || 500;
    res.status(status).json({ error: e?.message || "Failed to create purchase" });
    return;
  }

  await db.update(purchasesTable).set({
    totalAmount: computedTotal,
    grossAmount: computedSubtotal,
    taxAmount: computedTaxAmount,
    pendingAmount: isPaid ? 0 : computedTotal,
    paidAmount: isPaid ? computedTotal : 0,
    vendorInvoiceNumber: parsed.data.invoiceNumber || undefined,
    dueDate: parsed.data.dueDate || undefined,
  }).where(eq(purchasesTable.id, createdPurchase.id));

  res.status(201).json({
    ...createdPurchase,
    totalAmount: computedTotal,
    paymentMode,
    paymentStatus: isPaid ? "fully_paid" : "unpaid",
    vendorName,
    ...(await serializeBillAttachment(createdPurchase.billAttachment)),
  });
});

router.patch("/purchases/:id", authMiddleware, requirePermission("purchases.edit"), purchaseBillUploadMiddleware, async (req, res): Promise<void> => {
  const params = GetPurchaseParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = parsePurchaseRequestBody(req);
  if (!parsed.success) { res.status(400).json({ error: parsed.errorMessage }); return; }
  const dateErr = validateNotFutureDate(parsed.data.purchaseDate, "Purchase date");
  if (dateErr) { res.status(400).json({ error: dateErr }); return; }

  const validLines = parsed.data.lines.filter((line) => line.ingredientId > 0 && line.quantity > 0);
  if (validLines.length === 0) { res.status(400).json({ error: "At least one purchase line is required." }); return; }

  const paymentStatus = normalizePurchasePaymentStatus(parsed.data.paymentStatus);
  const paymentMode = paymentStatus === "fully_paid" ? (parsed.data.paymentMode || "cash") : null;
  const isPettyCash = paymentStatus === "fully_paid" && paymentMode === "petty_cash";
  const userId = (req as any).userId || null;
  const uploadedFile = req.file as Express.Multer.File | undefined;
  let uploadedBillAttachment: string | null = null;

  try {
    const tenantSchemaName = normalizeTenantSchemaName((req as any).tenantSchemaName);
    let existing: typeof purchasesTable.$inferSelect | null = null;
    const updated = await db.transaction(async (tx) => {
      await applyTenantSearchPath(tx, tenantSchemaName);
      const [existingRow] = await tx.select().from(purchasesTable).where(eq(purchasesTable.id, params.data.id)).limit(1);
      if (!existingRow) {
        throw Object.assign(new Error("Not found"), { httpStatus: 404 });
      }
      if (existingRow.verified && (req as any).userRole !== "admin") {
        throw Object.assign(new Error("Record is verified. Only admin can edit."), { httpStatus: 403 });
      }
      existing = existingRow;
      const uploadedAttachment = await uploadPurchaseBillAttachment({
        file: uploadedFile,
        tenantSchemaName,
        purchaseId: existingRow.id,
      });
      uploadedBillAttachment = uploadedAttachment;
      const nextBillAttachment = uploadedAttachment
        ? uploadedAttachment
        : parsed.removeBillAttachment
          ? null
          : existingRow.billAttachment || null;
      await removePurchaseStockImpact(tx, existingRow.id);
      await tx.delete(purchaseLinesTable).where(eq(purchaseLinesTable.purchaseId, existingRow.id));
      await deletePurchasePettyCashArtifacts(tx, existingRow);

      const lineTotals = await applyPurchaseLines(tx, existing.id, validLines as any);
      const totalAmount = round2(lineTotals.totalAmount);
      const [vendor] = await tx.select().from(vendorsTable).where(eq(vendorsTable.id, parsed.data.vendorId));
      const resolvedVendorName = vendor?.name ?? `vendor #${parsed.data.vendorId}`;

      const [purchase] = await tx.update(purchasesTable).set({
        purchaseDate: parsed.data.purchaseDate,
        vendorId: parsed.data.vendorId,
        invoiceNumber: parsed.data.invoiceNumber,
        vendorInvoiceNumber: parsed.data.invoiceNumber || undefined,
        dueDate: parsed.data.dueDate || undefined,
        paymentMode,
        paymentStatus,
        notes: parsed.data.notes,
        billAttachment: nextBillAttachment,
        totalAmount,
        grossAmount: lineTotals.subtotal,
        taxAmount: lineTotals.taxAmount,
        pendingAmount: paymentStatus === "fully_paid" ? 0 : totalAmount,
        paidAmount: paymentStatus === "fully_paid" ? totalAmount : 0,
        lastPaymentDate: paymentStatus === "fully_paid" ? parsed.data.purchaseDate : null,
        linkedExpenseId: null,
      }).where(eq(purchasesTable.id, existingRow.id)).returning();

      await rebuildVendorLedgerForPurchase(tx, {
        purchaseId: existingRow.id,
        vendorId: parsed.data.vendorId,
        purchaseDate: parsed.data.purchaseDate,
        purchaseNumber: existingRow.purchaseNumber,
        invoiceNumber: parsed.data.invoiceNumber,
        totalAmount,
        paymentMode,
        paymentStatus,
      });

      if (isPettyCash) {
        await createPurchasePettyCashArtifacts(tx, {
          purchase,
          vendorName: resolvedVendorName,
          subtotal: lineTotals.subtotal,
          taxAmount: lineTotals.taxAmount,
          totalAmount,
          purchaseDate: parsed.data.purchaseDate,
          invoiceNumber: parsed.data.invoiceNumber,
          userId,
        });
      }

      await recalculateVendorLedger(tx, existingRow.vendorId);
      if (parsed.data.vendorId !== existingRow.vendorId) {
        await recalculateVendorLedger(tx, parsed.data.vendorId);
      }

      const [freshPurchase] = await tx.select().from(purchasesTable).where(eq(purchasesTable.id, existingRow.id)).limit(1);
      return freshPurchase ?? purchase;
    });

    if (!existing) {
      throw Object.assign(new Error("Not found"), { httpStatus: 404 });
    }

    await createAuditLog("purchases", existing.id, "update", existing, {
      vendorId: parsed.data.vendorId,
      purchaseDate: parsed.data.purchaseDate,
      invoiceNumber: parsed.data.invoiceNumber,
      totalAmount: updated.totalAmount,
      paymentMode,
      paymentStatus,
      billAttachmentChanged: existing.billAttachment !== updated.billAttachment,
    });

    if (existing.billAttachment && existing.billAttachment !== updated.billAttachment) {
      await deletePurchaseBillFile(existing.billAttachment);
    }

    const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, updated.vendorId));
    res.json({ ...updated, vendorName: vendor?.name ?? "", ...(await serializeBillAttachment(updated.billAttachment)) });
  } catch (e: any) {
    if (uploadedBillAttachment) {
      await deletePurchaseBillFile(uploadedBillAttachment).catch(() => undefined);
    }
    res.status(e?.httpStatus || 500).json({ error: e?.message || "Failed to update purchase" });
  }
});

router.get("/purchases/:id", async (req, res): Promise<void> => {
  const params = GetPurchaseParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [purchase] = await db
    .select({
      id: purchasesTable.id,
      purchaseNumber: purchasesTable.purchaseNumber,
      purchaseDate: purchasesTable.purchaseDate,
      vendorId: purchasesTable.vendorId,
      vendorName: vendorsTable.name,
      invoiceNumber: purchasesTable.invoiceNumber,
      paymentMode: purchasesTable.paymentMode,
      paymentStatus: purchasesTable.paymentStatus,
      totalAmount: purchasesTable.totalAmount,
      billAttachment: purchasesTable.billAttachment,
      notes: purchasesTable.notes,
      createdAt: purchasesTable.createdAt,
    })
    .from(purchasesTable)
    .leftJoin(vendorsTable, eq(purchasesTable.vendorId, vendorsTable.id))
    .where(eq(purchasesTable.id, params.data.id));

  if (!purchase) { res.status(404).json({ error: "Not found" }); return; }

  const lines = await db
    .select({
      id: purchaseLinesTable.id,
      purchaseId: purchaseLinesTable.purchaseId,
      ingredientId: purchaseLinesTable.ingredientId,
      ingredientName: ingredientsTable.name,
      quantity: purchaseLinesTable.quantity,
      purchaseUom: purchaseLinesTable.purchaseUom,
      unitRate: purchaseLinesTable.unitRate,
      taxPercent: purchaseLinesTable.taxPercent,
      lineTotal: purchaseLinesTable.lineTotal,
      expiryDate: purchaseLinesTable.expiryDate,
    })
    .from(purchaseLinesTable)
    .leftJoin(ingredientsTable, eq(purchaseLinesTable.ingredientId, ingredientsTable.id))
    .where(eq(purchaseLinesTable.purchaseId, params.data.id));

  res.json(GetPurchaseResponse.parse({ purchase: { ...purchase, ...(await serializeBillAttachment(purchase.billAttachment)) }, lines }));
});

router.get("/uploads/purchase-bills/:filename", authMiddleware, async (req, res): Promise<void> => {
  const filename = String(req.params.filename || "").trim();
  if (!filename) { res.status(400).json({ error: "Missing filename" }); return; }
  const decoded = path.basename(decodeURIComponent(filename));
  const diskPath = path.join(PURCHASE_BILL_DIR, decoded);
  if (!fs.existsSync(diskPath)) { res.status(404).json({ error: "Not found" }); return; }
  res.sendFile(diskPath);
});

router.get("/purchases/:id/pdf", authMiddleware, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }

  const [purchase] = await db.select().from(purchasesTable).where(eq(purchasesTable.id, id));
  if (!purchase) { res.status(404).json({ error: "Not found" }); return; }

  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, purchase.vendorId));

  const lines = await db
    .select({
      id: purchaseLinesTable.id,
      ingredientId: purchaseLinesTable.ingredientId,
      ingredientName: ingredientsTable.name,
      quantity: purchaseLinesTable.quantity,
      purchaseUom: purchaseLinesTable.purchaseUom,
      unitRate: purchaseLinesTable.unitRate,
      taxPercent: purchaseLinesTable.taxPercent,
      lineTotal: purchaseLinesTable.lineTotal,
      expiryDate: purchaseLinesTable.expiryDate,
    })
    .from(purchaseLinesTable)
    .leftJoin(ingredientsTable, eq(purchaseLinesTable.ingredientId, ingredientsTable.id))
    .where(eq(purchaseLinesTable.purchaseId, id));

  let subtotal = 0;
  let tax = 0;
  for (const l of lines) {
    const base = (l.quantity || 0) * (l.unitRate || 0);
    subtotal += base;
    tax += base * ((l.taxPercent || 0) / 100);
  }
  const total = subtotal + tax;
  const totals = {
    subtotal,
    tax,
    total,
    paid: purchase.paidAmount || 0,
    pending: purchase.pendingAmount ?? Math.max(total - (purchase.paidAmount || 0), 0),
  };

  const buf = await generateBillPdf({ purchase, vendor, lines, totals });
  const safeVendor = (vendor?.name || "vendor").replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = `${purchase.purchaseNumber}_${safeVendor}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buf);
});

router.patch("/purchases/:id/verify", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [purchase] = await db.update(purchasesTable).set({ verified: true, verifiedBy: (req as any).userId, verifiedAt: new Date() }).where(eq(purchasesTable.id, id)).returning();
  if (!purchase) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("purchases", purchase.id, "verify", null, purchase);
  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, purchase.vendorId));
  res.json({ ...purchase, vendorName: vendor?.name ?? "" });
});

router.patch("/purchases/:id/unverify", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [purchase] = await db.update(purchasesTable).set({ verified: false, verifiedBy: null, verifiedAt: null }).where(eq(purchasesTable.id, id)).returning();
  if (!purchase) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("purchases", purchase.id, "unverify", null, purchase);
  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, purchase.vendorId));
  res.json({ ...purchase, vendorName: vendor?.name ?? "" });
});

router.delete("/purchases/:id", authMiddleware, requirePermission("purchases.delete"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(purchasesTable).where(eq(purchasesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.verified && (req as any).userRole !== "admin") { res.status(403).json({ error: "Record is verified. Only admin can delete." }); return; }

  try {
    await db.transaction(async (tx) => {
      await removePurchaseStockImpact(tx, id);
      await deletePurchasePettyCashArtifacts(tx, existing);

      await tx.execute(sql`SELECT pg_advisory_xact_lock(57000000, ${existing.vendorId})`);
      await tx.delete(vendorLedgerTable).where(and(
        eq(vendorLedgerTable.referenceType, "purchase"),
        eq(vendorLedgerTable.referenceId, id),
      ));
      await tx.delete(purchaseLinesTable).where(eq(purchaseLinesTable.purchaseId, id));
      await tx.delete(purchasesTable).where(eq(purchasesTable.id, id));
      await recalculateVendorLedger(tx, existing.vendorId);
    });
  } catch (e: any) {
    res.status(e?.httpStatus || 500).json({ error: e?.message || "Failed to delete purchase" });
    return;
  }

  if (existing.billAttachment) {
    await deletePurchaseBillFile(existing.billAttachment);
  }

  await createAuditLog("purchases", id, "delete", existing, null);
  res.json({ success: true });
});

export default router;
