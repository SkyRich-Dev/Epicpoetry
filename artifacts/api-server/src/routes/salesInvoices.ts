import { Router, type IRouter } from "express";
import { eq, and, gte, lte, sql, desc, inArray } from "drizzle-orm";
import {
  db, salesInvoicesTable, salesInvoiceLinesTable, menuItemsTable,
  salesImportBatchesTable, recipeLinesTable, ingredientsTable
} from "@workspace/db";
import { authMiddleware, adminOnly } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { validateNotFutureDate } from "../lib/dateValidation";

const router: IRouter = Router();

function generateInvoiceNo(source: string): string {
  const prefix = source === "petpooja" ? "PP" : source === "excel" ? "XL" : "INV";
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

router.get("/sales-invoices", authMiddleware, async (req, res): Promise<void> => {
  const conditions: any[] = [];
  if (req.query.fromDate) conditions.push(gte(salesInvoicesTable.salesDate, req.query.fromDate as string));
  if (req.query.toDate) conditions.push(lte(salesInvoicesTable.salesDate, req.query.toDate as string));
  if (req.query.sourceType) conditions.push(eq(salesInvoicesTable.sourceType, req.query.sourceType as string));
  if (req.query.orderType) conditions.push(eq(salesInvoicesTable.orderType, req.query.orderType as string));
  if (req.query.matchStatus) conditions.push(eq(salesInvoicesTable.matchStatus, req.query.matchStatus as string));
  if (req.query.date) conditions.push(eq(salesInvoicesTable.salesDate, req.query.date as string));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const query = db.select().from(salesInvoicesTable);
  const invoices = whereClause
    ? await query.where(whereClause).orderBy(desc(salesInvoicesTable.createdAt))
    : await query.orderBy(desc(salesInvoicesTable.createdAt));
  res.json(invoices);
});

router.get("/sales-invoices/:id", authMiddleware, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [invoice] = await db.select().from(salesInvoicesTable).where(eq(salesInvoicesTable.id, id));
  if (!invoice) { res.status(404).json({ error: "Not found" }); return; }

  const lines = await db.select({
    id: salesInvoiceLinesTable.id,
    invoiceId: salesInvoiceLinesTable.invoiceId,
    menuItemId: salesInvoiceLinesTable.menuItemId,
    menuItemName: menuItemsTable.name,
    itemCodeSnapshot: salesInvoiceLinesTable.itemCodeSnapshot,
    itemNameSnapshot: salesInvoiceLinesTable.itemNameSnapshot,
    quantity: salesInvoiceLinesTable.quantity,
    fixedPrice: salesInvoiceLinesTable.fixedPrice,
    grossLineAmount: salesInvoiceLinesTable.grossLineAmount,
    lineDiscountAmount: salesInvoiceLinesTable.lineDiscountAmount,
    discountedUnitPrice: salesInvoiceLinesTable.discountedUnitPrice,
    taxableLineAmount: salesInvoiceLinesTable.taxableLineAmount,
    gstPercent: salesInvoiceLinesTable.gstPercent,
    gstAmount: salesInvoiceLinesTable.gstAmount,
    finalLineAmount: salesInvoiceLinesTable.finalLineAmount,
    notes: salesInvoiceLinesTable.notes,
  }).from(salesInvoiceLinesTable)
    .leftJoin(menuItemsTable, eq(salesInvoiceLinesTable.menuItemId, menuItemsTable.id))
    .where(eq(salesInvoiceLinesTable.invoiceId, id));

  res.json({ ...invoice, lines });
});

router.post("/sales-invoices", authMiddleware, async (req, res): Promise<void> => {
  const {
    salesDate, invoiceNo, invoiceTime, sourceType, orderType, customerName,
    totalDiscount, paymentMode, paymentReference, lines, gstInclusive
  } = req.body;
  const dateErr = validateNotFutureDate(salesDate, "Invoice date");
  if (dateErr) { res.status(400).json({ error: dateErr }); return; }

  if (!salesDate || !lines || !Array.isArray(lines) || lines.length === 0) {
    res.status(400).json({ error: "salesDate and lines required" }); return;
  }

  const finalInvoiceNo = invoiceNo || generateInvoiceNo(sourceType || "manual");

  let grossAmount = 0;
  let totalGst = 0;
  const processedLines: any[] = [];

  for (const line of lines) {
    const [menuItem] = await db.select().from(menuItemsTable).where(eq(menuItemsTable.id, line.menuItemId));
    if (!menuItem) { res.status(400).json({ error: `Menu item ${line.menuItemId} not found` }); return; }

    const fixedPrice = line.fixedPrice ?? menuItem.sellingPrice;
    const qty = line.quantity;
    const lineGross = qty * fixedPrice;
    grossAmount += lineGross;

    processedLines.push({
      ...line,
      fixedPrice,
      lineGross,
      menuItemCode: menuItem.code || '',
      menuItemName: menuItem.name,
      gstPercent: line.gstPercent ?? 0,
    });
  }

  const invoiceDiscount = totalDiscount ?? 0;

  const finalLines: any[] = [];
  for (const pl of processedLines) {
    const allocatedDiscount = grossAmount > 0
      ? Math.round((pl.lineGross / grossAmount) * invoiceDiscount * 100) / 100
      : 0;
    const lineDiscount = pl.lineDiscountAmount ?? allocatedDiscount;
    const discountedGross = pl.lineGross - lineDiscount;
    const discountedUnitPrice = pl.quantity > 0 ? discountedGross / pl.quantity : 0;

    let taxableAmount: number, gstAmt: number, finalAmount: number;
    if (gstInclusive) {
      finalAmount = discountedGross;
      taxableAmount = pl.gstPercent > 0 ? finalAmount / (1 + pl.gstPercent / 100) : finalAmount;
      gstAmt = finalAmount - taxableAmount;
    } else {
      taxableAmount = discountedGross;
      gstAmt = taxableAmount * (pl.gstPercent / 100);
      finalAmount = taxableAmount + gstAmt;
    }

    totalGst += gstAmt;

    finalLines.push({
      menuItemId: pl.menuItemId,
      itemCodeSnapshot: pl.menuItemCode,
      itemNameSnapshot: pl.menuItemName,
      quantity: pl.quantity,
      fixedPrice: pl.fixedPrice,
      grossLineAmount: Math.round(pl.lineGross * 100) / 100,
      lineDiscountAmount: Math.round(lineDiscount * 100) / 100,
      discountedUnitPrice: Math.round(discountedUnitPrice * 100) / 100,
      taxableLineAmount: Math.round(taxableAmount * 100) / 100,
      gstPercent: pl.gstPercent,
      gstAmount: Math.round(gstAmt * 100) / 100,
      finalLineAmount: Math.round(finalAmount * 100) / 100,
      notes: pl.notes,
    });
  }

  const lineFinalTotal = finalLines.reduce((s, l) => s + l.finalLineAmount, 0);
  const invoiceFinal = req.body.finalAmount ?? lineFinalTotal;
  const taxableTotal = finalLines.reduce((s, l) => s + l.taxableLineAmount, 0);
  const matchDiff = Math.abs(invoiceFinal - lineFinalTotal);
  const matchStatus = matchDiff <= (req.body.tolerance ?? 1) ? "matched" : "mismatched";

  const [invoice] = await db.insert(salesInvoicesTable).values({
    salesDate,
    invoiceNo: finalInvoiceNo,
    invoiceTime: invoiceTime || null,
    sourceType: sourceType || "manual",
    orderType: orderType || "dine-in",
    customerName: customerName || null,
    grossAmount: Math.round(grossAmount * 100) / 100,
    totalDiscount: Math.round(invoiceDiscount * 100) / 100,
    taxableAmount: Math.round(taxableTotal * 100) / 100,
    gstAmount: Math.round(totalGst * 100) / 100,
    finalAmount: Math.round(invoiceFinal * 100) / 100,
    paymentMode: paymentMode || "cash",
    paymentReference: paymentReference || null,
    matchStatus,
    matchDifference: Math.round(matchDiff * 100) / 100,
    createdBy: (req as any).userId,
  }).returning();

  for (const fl of finalLines) {
    await db.insert(salesInvoiceLinesTable).values({
      invoiceId: invoice.id,
      ...fl,
    });
  }

  const menuItemIds = [...new Set(finalLines.map(l => l.menuItemId))];
  for (const menuItemId of menuItemIds) {
    const totalQtySold = finalLines.filter(l => l.menuItemId === menuItemId).reduce((s, l) => s + l.quantity, 0);
    const recipeLines = await db.select().from(recipeLinesTable).where(eq(recipeLinesTable.menuItemId, menuItemId));
    for (const rl of recipeLines) {
      const [ing] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, rl.ingredientId));
      if (ing) {
        const netQtyPerUnit = rl.quantity * (1 + (rl.wastagePercent || 0) / 100);
        const totalRecipeQty = netQtyPerUnit * totalQtySold;
        const deductInStockUom = totalRecipeQty / (ing.conversionFactor || 1);
        await db.update(ingredientsTable).set({
          currentStock: Math.max(0, ing.currentStock - deductInStockUom),
        }).where(eq(ingredientsTable.id, rl.ingredientId));
      }
    }
  }

  await createAuditLog("sales_invoices", invoice.id, "create", null, { invoiceNo: finalInvoiceNo, finalAmount: invoiceFinal });
  res.status(201).json({ ...invoice, lines: finalLines });
});

router.patch("/sales-invoices/:id", authMiddleware, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(salesInvoicesTable).where(eq(salesInvoicesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.verified && (req as any).userRole !== "admin") {
    res.status(403).json({ error: "Verified. Admin only." }); return;
  }

  if (req.body.salesDate) { const dateErr = validateNotFutureDate(req.body.salesDate, "Invoice date"); if (dateErr) { res.status(400).json({ error: dateErr }); return; } }
  const updates: any = {};
  const fields = ["salesDate", "invoiceNo", "invoiceTime", "orderType", "customerName", "paymentMode", "paymentReference"];
  for (const f of fields) if (req.body[f] !== undefined) updates[f] = req.body[f];
  updates.updatedBy = (req as any).userId;

  const [updated] = await db.update(salesInvoicesTable).set(updates).where(eq(salesInvoicesTable.id, id)).returning();
  await createAuditLog("sales_invoices", id, "update", existing, updated);
  res.json(updated);
});

router.delete("/sales-invoices/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(salesInvoicesTable).where(eq(salesInvoicesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const invoiceLines = await db.select().from(salesInvoiceLinesTable).where(eq(salesInvoiceLinesTable.invoiceId, id));
  const menuItemIds = [...new Set(invoiceLines.map(l => l.menuItemId))];
  for (const menuItemId of menuItemIds) {
    const totalQtySold = invoiceLines.filter(l => l.menuItemId === menuItemId).reduce((s, l) => s + l.quantity, 0);
    const recipeLines = await db.select().from(recipeLinesTable).where(eq(recipeLinesTable.menuItemId, menuItemId));
    for (const rl of recipeLines) {
      const [ing] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, rl.ingredientId));
      if (ing) {
        const netQtyPerUnit = rl.quantity * (1 + (rl.wastagePercent || 0) / 100);
        const totalRecipeQty = netQtyPerUnit * totalQtySold;
        const restoreInStockUom = totalRecipeQty / (ing.conversionFactor || 1);
        await db.update(ingredientsTable).set({
          currentStock: ing.currentStock + restoreInStockUom,
        }).where(eq(ingredientsTable.id, rl.ingredientId));
      }
    }
  }

  await db.delete(salesInvoiceLinesTable).where(eq(salesInvoiceLinesTable.invoiceId, id));
  await db.delete(salesInvoicesTable).where(eq(salesInvoicesTable.id, id));
  await createAuditLog("sales_invoices", id, "delete", existing, null);
  res.json({ success: true });
});

router.patch("/sales-invoices/:id/verify", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [invoice] = await db.update(salesInvoicesTable).set({
    verified: true, verifiedBy: (req as any).userId, verifiedAt: new Date()
  }).where(eq(salesInvoicesTable.id, id)).returning();
  if (!invoice) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("sales_invoices", id, "verify", null, invoice);
  res.json(invoice);
});

router.patch("/sales-invoices/:id/unverify", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [invoice] = await db.update(salesInvoicesTable).set({
    verified: false, verifiedBy: null, verifiedAt: null
  }).where(eq(salesInvoicesTable.id, id)).returning();
  if (!invoice) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("sales_invoices", id, "unverify", null, invoice);
  res.json(invoice);
});

router.get("/sales-invoices-item-summary", authMiddleware, async (req, res): Promise<void> => {
  const conditions: any[] = [];
  if (req.query.fromDate) conditions.push(gte(salesInvoicesTable.salesDate, req.query.fromDate as string));
  if (req.query.toDate) conditions.push(lte(salesInvoicesTable.salesDate, req.query.toDate as string));
  if (req.query.date) conditions.push(eq(salesInvoicesTable.salesDate, req.query.date as string));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  let invoiceIds: number[];
  if (whereClause) {
    const invoices = await db.select({ id: salesInvoicesTable.id }).from(salesInvoicesTable).where(whereClause);
    invoiceIds = invoices.map(i => i.id);
  } else {
    const invoices = await db.select({ id: salesInvoicesTable.id }).from(salesInvoicesTable);
    invoiceIds = invoices.map(i => i.id);
  }

  if (invoiceIds.length === 0) { res.json([]); return; }

  const allLines = await db.select({
    menuItemId: salesInvoiceLinesTable.menuItemId,
    itemCodeSnapshot: salesInvoiceLinesTable.itemCodeSnapshot,
    itemNameSnapshot: salesInvoiceLinesTable.itemNameSnapshot,
    quantity: salesInvoiceLinesTable.quantity,
    fixedPrice: salesInvoiceLinesTable.fixedPrice,
    grossLineAmount: salesInvoiceLinesTable.grossLineAmount,
    lineDiscountAmount: salesInvoiceLinesTable.lineDiscountAmount,
    gstAmount: salesInvoiceLinesTable.gstAmount,
    finalLineAmount: salesInvoiceLinesTable.finalLineAmount,
    invoiceId: salesInvoiceLinesTable.invoiceId,
  }).from(salesInvoiceLinesTable)
    .where(sql`${salesInvoiceLinesTable.invoiceId} IN (${sql.join(invoiceIds.map(id => sql`${id}`), sql`, `)})`);

  const itemMap = new Map<number, any>();
  for (const line of allLines) {
    const existing = itemMap.get(line.menuItemId);
    if (existing) {
      existing.totalQty += line.quantity;
      existing.totalGross += line.grossLineAmount;
      existing.totalDiscount += line.lineDiscountAmount;
      existing.totalGst += line.gstAmount;
      existing.totalFinal += line.finalLineAmount;
      existing.invoiceIds.add(line.invoiceId);
    } else {
      itemMap.set(line.menuItemId, {
        menuItemId: line.menuItemId,
        itemCode: line.itemCodeSnapshot,
        itemName: line.itemNameSnapshot,
        fixedPrice: line.fixedPrice,
        totalQty: line.quantity,
        totalGross: line.grossLineAmount,
        totalDiscount: line.lineDiscountAmount,
        totalGst: line.gstAmount,
        totalFinal: line.finalLineAmount,
        invoiceIds: new Set([line.invoiceId]),
      });
    }
  }

  const result = Array.from(itemMap.values()).map(item => ({
    ...item,
    invoiceCount: item.invoiceIds.size,
    avgRealizedPrice: item.totalQty > 0 ? Math.round((item.totalFinal / item.totalQty) * 100) / 100 : 0,
    totalGross: Math.round(item.totalGross * 100) / 100,
    totalDiscount: Math.round(item.totalDiscount * 100) / 100,
    totalGst: Math.round(item.totalGst * 100) / 100,
    totalFinal: Math.round(item.totalFinal * 100) / 100,
    invoiceIds: undefined,
  }));

  res.json(result);
});

router.get("/sales-invoices-daily-summary", authMiddleware, async (req, res): Promise<void> => {
  const conditions: any[] = [];
  if (req.query.fromDate) conditions.push(gte(salesInvoicesTable.salesDate, req.query.fromDate as string));
  if (req.query.toDate) conditions.push(lte(salesInvoicesTable.salesDate, req.query.toDate as string));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const query = db.select().from(salesInvoicesTable);
  const invoices = whereClause ? await query.where(whereClause) : await query;

  const dayMap = new Map<string, any>();
  for (const inv of invoices) {
    const existing = dayMap.get(inv.salesDate);
    if (existing) {
      existing.totalInvoices += 1;
      existing.totalGross += inv.grossAmount;
      existing.totalDiscount += inv.totalDiscount;
      existing.totalGst += inv.gstAmount;
      existing.totalFinal += inv.finalAmount;
      if (inv.matchStatus === "mismatched") existing.mismatchCount += 1;
    } else {
      dayMap.set(inv.salesDate, {
        date: inv.salesDate,
        totalInvoices: 1,
        totalGross: inv.grossAmount,
        totalDiscount: inv.totalDiscount,
        totalGst: inv.gstAmount,
        totalFinal: inv.finalAmount,
        mismatchCount: inv.matchStatus === "mismatched" ? 1 : 0,
      });
    }
  }

  res.json(Array.from(dayMap.values()).sort((a, b) => b.date.localeCompare(a.date)));
});

router.get("/sales-invoices-consumption", authMiddleware, async (req, res): Promise<void> => {
  const conditions: any[] = [];
  if (req.query.fromDate) conditions.push(gte(salesInvoicesTable.salesDate, req.query.fromDate as string));
  if (req.query.toDate) conditions.push(lte(salesInvoicesTable.salesDate, req.query.toDate as string));
  if (req.query.date) conditions.push(eq(salesInvoicesTable.salesDate, req.query.date as string));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  let invoiceIds: number[];
  if (whereClause) {
    const invoices = await db.select({ id: salesInvoicesTable.id }).from(salesInvoicesTable).where(whereClause);
    invoiceIds = invoices.map(i => i.id);
  } else {
    const invoices = await db.select({ id: salesInvoicesTable.id }).from(salesInvoicesTable);
    invoiceIds = invoices.map(i => i.id);
  }

  if (invoiceIds.length === 0) { res.json([]); return; }

  const lines = await db.select({
    menuItemId: salesInvoiceLinesTable.menuItemId,
    quantity: salesInvoiceLinesTable.quantity,
  }).from(salesInvoiceLinesTable)
    .where(sql`${salesInvoiceLinesTable.invoiceId} IN (${sql.join(invoiceIds.map(id => sql`${id}`), sql`, `)})`);

  const itemQty = new Map<number, number>();
  for (const l of lines) {
    itemQty.set(l.menuItemId, (itemQty.get(l.menuItemId) || 0) + l.quantity);
  }

  const consumption = new Map<number, { ingredientId: number; ingredientName: string; totalQty: number; uom: string; costPerRecipeUnit: number }>();
  for (const [menuItemId, soldQty] of itemQty) {
    const recipeLines = await db.select({
      ingredientId: recipeLinesTable.ingredientId,
      ingredientName: ingredientsTable.name,
      quantity: recipeLinesTable.quantity,
      uom: recipeLinesTable.uom,
      lastPrice: ingredientsTable.latestCost,
      conversionFactor: ingredientsTable.conversionFactor,
    }).from(recipeLinesTable)
      .leftJoin(ingredientsTable, eq(recipeLinesTable.ingredientId, ingredientsTable.id))
      .where(eq(recipeLinesTable.menuItemId, menuItemId));

    for (const rl of recipeLines) {
      const key = rl.ingredientId;
      const existing = consumption.get(key);
      const needed = soldQty * rl.quantity;
      const factor = Number(rl.conversionFactor) || 1;
      const costPerRecipeUnit = (Number(rl.lastPrice) || 0) / factor;
      if (existing) {
        existing.totalQty += needed;
      } else {
        consumption.set(key, {
          ingredientId: rl.ingredientId,
          ingredientName: rl.ingredientName || '',
          totalQty: needed,
          uom: rl.uom || '',
          costPerRecipeUnit,
        });
      }
    }
  }

  res.json(Array.from(consumption.values()).map(c => ({
    ...c,
    totalQty: Math.round(c.totalQty * 1000) / 1000,
    rate: Math.round(c.costPerRecipeUnit * 10000) / 10000,
    estimatedCost: Math.round(c.totalQty * c.costPerRecipeUnit * 100) / 100,
  })));
});

export default router;
