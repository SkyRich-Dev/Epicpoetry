import { Router, type IRouter } from "express";
import { eq, and, gte, lte, asc, sql } from "drizzle-orm";
import { db, purchasesTable, purchaseLinesTable, vendorsTable, ingredientsTable, vendorLedgerTable, pettyCashLedgerTable, systemConfigTable } from "@workspace/db";
import { ListPurchasesResponse, CreatePurchaseBody, GetPurchaseParams, GetPurchaseResponse } from "@workspace/api-zod";
import { authMiddleware, adminOnly, requirePermission } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { generateCode } from "../lib/codeGenerator";
import { validateNotFutureDate } from "../lib/dateValidation";
import PDFDocument from "pdfkit";

function round2(n: number): number {
  return Math.round((n || 0) * 100) / 100;
}

const router: IRouter = Router();

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
): Promise<number> {
  let totalAmount = 0;
  for (const line of lines) {
    const taxPercent = line.taxPercent ?? 0;
    const quantity = line.quantity;
    const unitRate = line.unitRate;
    const lineTotal = round2(quantity * unitRate * (1 + taxPercent / 100));
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
  return totalAmount;
}

function normalizePurchasePaymentStatus(status?: string | null): "fully_paid" | "unpaid" {
  const value = String(status || "").trim().toLowerCase();
  return value === "paid" || value === "fully_paid" ? "fully_paid" : "unpaid";
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
  res.json(purchases);
});

router.post("/purchases", authMiddleware, requirePermission("purchases.create"), async (req, res): Promise<void> => {
  const parsed = CreatePurchaseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const dateErr = validateNotFutureDate(parsed.data.purchaseDate, "Purchase date");
  if (dateErr) { res.status(400).json({ error: dateErr }); return; }

  // Normalise payment fields. The form sends paymentStatus="paid" when the
  // "Paid" checkbox is ticked and paymentMode in { cash | petty_cash |
  // account | upi }. We translate to the canonical DB values: "fully_paid"
  // or "unpaid". Petty-cash purchases must atomically debit the petty-cash
  // ledger under the same advisory lock used by every other petty-cash
  // writer, so the whole route runs inside a transaction.
  const isPaid = parsed.data.paymentStatus === "paid";
  const paymentMode = parsed.data.paymentMode || (isPaid ? "cash" : null);
  const isPettyCash = isPaid && paymentMode === "petty_cash";

  const purchaseNumber = await generateCode("PUR", "purchases");
  const userId = (req as any).userId || null;

  let createdPurchase: typeof purchasesTable.$inferSelect;
  let computedTotal = 0;
  let vendorName = "";

  try {
    const result = await db.transaction(async (tx) => {
      const [purchase] = await tx.insert(purchasesTable).values({
        purchaseNumber,
        purchaseDate: parsed.data.purchaseDate,
        vendorId: parsed.data.vendorId,
        invoiceNumber: parsed.data.invoiceNumber,
        paymentMode,
        paymentStatus: isPaid ? "fully_paid" : "unpaid",
        notes: parsed.data.notes,
        totalAmount: 0,
      }).returning();

      let totalAmount = 0;
      for (const line of parsed.data.lines) {
        const lineTotal = line.quantity * line.unitRate * (1 + (line.taxPercent ?? 0) / 100);
        totalAmount += lineTotal;
        await tx.insert(purchaseLinesTable).values({
          purchaseId: purchase.id,
          ingredientId: line.ingredientId,
          quantity: line.quantity,
          purchaseUom: line.purchaseUom ?? "unit",
          unitRate: line.unitRate,
          taxPercent: line.taxPercent ?? 0,
          lineTotal,
          expiryDate: line.expiryDate || null,
        });

        const [ing] = await tx.select().from(ingredientsTable).where(eq(ingredientsTable.id, line.ingredientId));
        if (ing) {
          const newStock = ing.currentStock + line.quantity;
          const oldTotal = ing.weightedAvgCost * ing.currentStock;
          const newTotal = oldTotal + line.unitRate * line.quantity;
          const newAvg = newStock > 0 ? newTotal / newStock : line.unitRate;
          await tx.update(ingredientsTable).set({
            currentStock: newStock,
            latestCost: line.unitRate,
            weightedAvgCost: newAvg,
          }).where(eq(ingredientsTable.id, line.ingredientId));
        }
      }

      totalAmount = round2(totalAmount);
      const finalStatus = isPaid ? "fully_paid" : "unpaid";
      await tx.update(purchasesTable).set({
        totalAmount,
        grossAmount: totalAmount,
        pendingAmount: finalStatus === "fully_paid" ? 0 : totalAmount,
        paidAmount: finalStatus === "fully_paid" ? totalAmount : 0,
        paymentStatus: finalStatus,
        vendorInvoiceNumber: parsed.data.invoiceNumber || undefined,
        dueDate: parsed.data.dueDate || undefined,
        lastPaymentDate: finalStatus === "fully_paid" ? parsed.data.purchaseDate : undefined,
      }).where(eq(purchasesTable.id, purchase.id));

      // Vendor ledger: debit the vendor for the bill, then if it was paid
      // up-front we immediately credit the same amount so the vendor's
      // outstanding balance ends at zero for this purchase. Take a
      // vendor-scoped advisory lock so concurrent purchases for the same
      // vendor can't both observe the same previous balance and write
      // colliding running_balance values.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(57000000, ${parsed.data.vendorId})`);
      const lastLedger = await tx.select().from(vendorLedgerTable)
        .where(eq(vendorLedgerTable.vendorId, parsed.data.vendorId))
        .orderBy(vendorLedgerTable.id)
        .limit(1);
      let prevBalance = lastLedger.length > 0 ? lastLedger[0].runningBalance : 0;

      await tx.insert(vendorLedgerTable).values({
        vendorId: parsed.data.vendorId,
        transactionDate: parsed.data.purchaseDate,
        transactionType: "purchase",
        referenceType: "purchase",
        referenceId: purchase.id,
        debit: totalAmount,
        credit: 0,
        runningBalance: round2(prevBalance + totalAmount),
        description: `Purchase ${purchaseNumber} - ${parsed.data.invoiceNumber || 'No invoice'}`,
      });
      prevBalance = round2(prevBalance + totalAmount);

      if (isPaid) {
        await tx.insert(vendorLedgerTable).values({
          vendorId: parsed.data.vendorId,
          transactionDate: parsed.data.purchaseDate,
          transactionType: "payment",
          referenceType: "purchase",
          referenceId: purchase.id,
          debit: 0,
          credit: totalAmount,
          runningBalance: round2(prevBalance - totalAmount),
          description: `Paid on creation via ${paymentMode}`,
        });
      }

      // Petty-cash debit. Mirrors vendorPayments.ts:297-336 so concurrent
      // writers can't both observe the same balance and overdraw the
      // drawer. The same advisory lock 91234567 is taken by every
      // petty-cash insert path in this codebase.
      if (isPettyCash) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(91234567)`);

        const [vendorRow] = await tx.select({ name: vendorsTable.name })
          .from(vendorsTable)
          .where(eq(vendorsTable.id, parsed.data.vendorId))
          .limit(1);
        const vName = vendorRow?.name || `vendor #${parsed.data.vendorId}`;

        const [config] = await tx.select().from(systemConfigTable);
        const opening = Number(config?.pettyCashOpeningBalance || 0);
        const [agg] = await tx.select({
          sum: sql<number>`COALESCE(
            SUM(CASE WHEN transaction_type = 'receipt'    THEN amount ELSE 0 END) -
            SUM(CASE WHEN transaction_type = 'expense'    THEN amount ELSE 0 END) +
            SUM(CASE WHEN transaction_type = 'adjustment' THEN amount ELSE 0 END), 0)`
        }).from(pettyCashLedgerTable);
        const pcBalance = round2(opening + Number(agg?.sum || 0));

        if (pcBalance + 0.01 < totalAmount) {
          throw Object.assign(
            new Error(`Insufficient petty cash balance. Available: ₹${pcBalance.toFixed(2)}, requested: ₹${totalAmount.toFixed(2)}`),
            { httpStatus: 400 },
          );
        }

        await tx.insert(pettyCashLedgerTable).values({
          transactionDate: parsed.data.purchaseDate,
          transactionType: "expense",
          amount: totalAmount,
          method: "cash",
          counterpartyName: vName,
          category: "purchase",
          linkedExpenseId: null,
          description: `Purchase ${purchaseNumber} - ${vName}${parsed.data.invoiceNumber ? ` (Invoice ${parsed.data.invoiceNumber})` : ""}`,
          runningBalance: round2(pcBalance - totalAmount),
          approvalStatus: "approved",
          createdBy: userId,
        });
      }

      const [vendor] = await tx.select().from(vendorsTable).where(eq(vendorsTable.id, parsed.data.vendorId));
      return { purchase, totalAmount, vendorName: vendor?.name ?? "" };
    });
    createdPurchase = result.purchase;
    computedTotal = result.totalAmount;
    vendorName = result.vendorName;
  } catch (e: any) {
    const status = e?.httpStatus || 500;
    res.status(status).json({ error: e?.message || "Failed to create purchase" });
    return;
  }

  // Fill in the financial-tracking columns added on origin (gross / paid /
  // pending / vendor invoice / due date). Local INSERT only sets paymentStatus
  // and a placeholder totalAmount=0, so without this UPDATE these columns
  // would stay at default 0 and break payables/aging reports.
  await db.update(purchasesTable).set({
    totalAmount: computedTotal,
    grossAmount: computedTotal,
    pendingAmount: isPaid ? 0 : computedTotal,
    paidAmount: isPaid ? computedTotal : 0,
    vendorInvoiceNumber: parsed.data.invoiceNumber || undefined,
    dueDate: parsed.data.dueDate || undefined,
  }).where(eq(purchasesTable.id, createdPurchase.id));

  await createAuditLog("purchases", createdPurchase.id, "create", null, { purchaseNumber, totalAmount: computedTotal, paymentMode, isPaid });

  res.status(201).json({
    ...createdPurchase,
    totalAmount: computedTotal,
    paymentMode,
    paymentStatus: isPaid ? "fully_paid" : "unpaid",
    vendorName,
  });
});

router.patch("/purchases/:id", authMiddleware, requirePermission("purchases.edit"), async (req, res): Promise<void> => {
  const params = GetPurchaseParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = CreatePurchaseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const dateErr = validateNotFutureDate(parsed.data.purchaseDate, "Purchase date");
  if (dateErr) { res.status(400).json({ error: dateErr }); return; }

  const [existing] = await db.select().from(purchasesTable).where(eq(purchasesTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.verified && (req as any).userRole !== "admin") { res.status(403).json({ error: "Record is verified. Only admin can edit." }); return; }
  if ((existing.paidAmount || 0) > 0) { res.status(403).json({ error: "Paid purchases cannot be edited." }); return; }

  const validLines = parsed.data.lines.filter((line) => line.ingredientId > 0 && line.quantity > 0);
  if (validLines.length === 0) { res.status(400).json({ error: "At least one purchase line is required." }); return; }

  try {
    const tenantSchemaName = normalizeTenantSchemaName((req as any).tenantSchemaName);
    const updated = await db.transaction(async (tx) => {
      if (tenantSchemaName) {
        await tx.execute(sql`select set_config('search_path', ${`"${tenantSchemaName}", public`}, false)`);
      }
      await removePurchaseStockImpact(tx, existing.id);
      await tx.delete(purchaseLinesTable).where(eq(purchaseLinesTable.purchaseId, existing.id));

      const totalAmount = await applyPurchaseLines(tx, existing.id, validLines as any);
      const paymentStatus = normalizePurchasePaymentStatus(parsed.data.paymentStatus);

      const [purchase] = await tx.update(purchasesTable).set({
        purchaseDate: parsed.data.purchaseDate,
        vendorId: parsed.data.vendorId,
        invoiceNumber: parsed.data.invoiceNumber,
        vendorInvoiceNumber: parsed.data.invoiceNumber || undefined,
        paymentMode: parsed.data.paymentMode,
        paymentStatus,
        notes: parsed.data.notes,
        totalAmount,
        grossAmount: totalAmount,
        pendingAmount: paymentStatus === "fully_paid" ? 0 : totalAmount,
        paidAmount: paymentStatus === "fully_paid" ? totalAmount : 0,
      }).where(eq(purchasesTable.id, existing.id)).returning();

      const [ledgerEntry] = await tx.select().from(vendorLedgerTable).where(and(
        eq(vendorLedgerTable.referenceType, "purchase"),
        eq(vendorLedgerTable.referenceId, existing.id),
      ));

      if (ledgerEntry) {
        await tx.update(vendorLedgerTable).set({
          vendorId: parsed.data.vendorId,
          transactionDate: parsed.data.purchaseDate,
          debit: totalAmount,
          credit: 0,
          description: `Purchase ${existing.purchaseNumber} - ${parsed.data.invoiceNumber || 'No invoice'}`,
        }).where(eq(vendorLedgerTable.id, ledgerEntry.id));
      } else {
        await tx.insert(vendorLedgerTable).values({
          vendorId: parsed.data.vendorId,
          transactionDate: parsed.data.purchaseDate,
          transactionType: "purchase",
          referenceType: "purchase",
          referenceId: existing.id,
          debit: totalAmount,
          credit: 0,
          runningBalance: 0,
          description: `Purchase ${existing.purchaseNumber} - ${parsed.data.invoiceNumber || 'No invoice'}`,
        });
      }

      await recalculateVendorLedger(tx, existing.vendorId);
      if (parsed.data.vendorId !== existing.vendorId) {
        await recalculateVendorLedger(tx, parsed.data.vendorId);
      }

      return purchase;
    });

    await createAuditLog("purchases", existing.id, "update", existing, {
      vendorId: parsed.data.vendorId,
      purchaseDate: parsed.data.purchaseDate,
      invoiceNumber: parsed.data.invoiceNumber,
      totalAmount: updated.totalAmount,
    });

    const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, updated.vendorId));
    res.json({ ...updated, vendorName: vendor?.name ?? "" });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to update purchase" });
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

  res.json(GetPurchaseResponse.parse({ purchase, lines }));
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

  // Reverse every financial side-effect this purchase produced, atomically.
  // Side-effects to undo:
  //   1. ingredient stock (we added `quantity`)
  //   2. vendor_ledger debit/credit rows referencing this purchase
  //   3. petty_cash_ledger row (only if this purchase was paid via petty cash)
  // Both ledger reversals run under the same advisory locks the writers use
  // so concurrent operations on the affected vendor / petty-cash drawer
  // observe a consistent balance.
  const wasPettyCash = existing.paymentStatus === "fully_paid" && existing.paymentMode === "petty_cash";
  const purchaseTotal = round2(Number(existing.totalAmount || 0));

  try {
    await db.transaction(async (tx) => {
      const lines = await tx.select().from(purchaseLinesTable).where(eq(purchaseLinesTable.purchaseId, id));
      for (const line of lines) {
        const [ing] = await tx.select().from(ingredientsTable).where(eq(ingredientsTable.id, line.ingredientId));
        if (ing) {
          const newStock = Math.max(0, ing.currentStock - line.quantity);
          await tx.update(ingredientsTable).set({ currentStock: newStock }).where(eq(ingredientsTable.id, line.ingredientId));
        }
      }

      // Vendor ledger cleanup. Take a vendor-scoped lock matching the writer.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(57000000, ${existing.vendorId})`);
      await tx.delete(vendorLedgerTable).where(and(
        eq(vendorLedgerTable.referenceType, "purchase"),
        eq(vendorLedgerTable.referenceId, id),
      ));

      // Petty-cash refund. Rather than deleting historic rows we post a
      // compensating receipt so the ledger remains an append-only audit
      // trail (matches the pattern used by vendorPayments DELETE).
      if (wasPettyCash && purchaseTotal > 0) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(91234567)`);
        const [config] = await tx.select().from(systemConfigTable);
        const opening = Number(config?.pettyCashOpeningBalance || 0);
        const [agg] = await tx.select({
          sum: sql<number>`COALESCE(
            SUM(CASE WHEN transaction_type = 'receipt'    THEN amount ELSE 0 END) -
            SUM(CASE WHEN transaction_type = 'expense'    THEN amount ELSE 0 END) +
            SUM(CASE WHEN transaction_type = 'adjustment' THEN amount ELSE 0 END), 0)`
        }).from(pettyCashLedgerTable);
        const pcBalance = round2(opening + Number(agg?.sum || 0));

        await tx.insert(pettyCashLedgerTable).values({
          transactionDate: new Date().toISOString().split("T")[0],
          transactionType: "receipt",
          amount: purchaseTotal,
          method: "cash",
          counterpartyName: null,
          category: "purchase_reversal",
          linkedExpenseId: null,
          description: `Reversal of petty-cash purchase ${existing.purchaseNumber}`,
          runningBalance: round2(pcBalance + purchaseTotal),
          approvalStatus: "approved",
          createdBy: (req as any).userId || null,
        });
      }

      await tx.delete(purchaseLinesTable).where(eq(purchaseLinesTable.purchaseId, id));
      await tx.delete(purchasesTable).where(eq(purchasesTable.id, id));
    });
  } catch (e: any) {
    res.status(e?.httpStatus || 500).json({ error: e?.message || "Failed to delete purchase" });
    return;
  }

  await createAuditLog("purchases", id, "delete", existing, null);
  res.json({ success: true });
});

export default router;
