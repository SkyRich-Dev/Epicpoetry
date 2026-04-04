import { Router, type IRouter } from "express";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { db, dailySalesSettlementsTable, settlementLinesTable, salesEntriesTable } from "@workspace/db";
import { authMiddleware } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { validateNotFutureDate } from "../lib/dateValidation";

const router: IRouter = Router();

router.get("/settlements/sales-summary", authMiddleware, async (req, res): Promise<void> => {
  const date = req.query.date as string;
  if (!date) { res.status(400).json({ error: "date required" }); return; }

  const sales = await db.select({
    totalAmount: salesEntriesTable.totalAmount,
    discount: salesEntriesTable.discount,
  }).from(salesEntriesTable).where(eq(salesEntriesTable.salesDate, date));

  const grossSales = sales.reduce((sum, s) => sum + (s.totalAmount || 0), 0);
  const totalDiscount = sales.reduce((sum, s) => sum + (s.discount || 0), 0);
  const netSales = grossSales - totalDiscount;

  res.json({
    date,
    grossSales,
    totalDiscount,
    netSales,
    itemCount: sales.length,
  });
});

router.get("/settlements", authMiddleware, async (req, res): Promise<void> => {
  const conditions = [];
  if (req.query.fromDate) conditions.push(gte(dailySalesSettlementsTable.settlementDate, req.query.fromDate as string));
  if (req.query.toDate) conditions.push(lte(dailySalesSettlementsTable.settlementDate, req.query.toDate as string));
  if (req.query.status) conditions.push(eq(dailySalesSettlementsTable.status, req.query.status as string));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const settlements = whereClause
    ? await db.select().from(dailySalesSettlementsTable).where(whereClause).orderBy(desc(dailySalesSettlementsTable.settlementDate))
    : await db.select().from(dailySalesSettlementsTable).orderBy(desc(dailySalesSettlementsTable.settlementDate));

  res.json(settlements);
});

router.post("/settlements", authMiddleware, async (req, res): Promise<void> => {
  const { settlementDate, remarks, lines } = req.body;
  if (!settlementDate || !lines || !Array.isArray(lines) || lines.length === 0) {
    res.status(400).json({ error: "settlementDate and lines are required" });
    return;
  }
  const dateErr = validateNotFutureDate(settlementDate, "Settlement date");
  if (dateErr) { res.status(400).json({ error: dateErr }); return; }

  const [existing] = await db.select().from(dailySalesSettlementsTable).where(eq(dailySalesSettlementsTable.settlementDate, settlementDate));
  if (existing) { res.status(400).json({ error: "A settlement already exists for this date. Edit the existing one instead." }); return; }

  for (const line of lines) {
    if (!line.paymentMode || Number(line.amount) < 0) {
      res.status(400).json({ error: "Each line must have a payment mode and non-negative amount" });
      return;
    }
  }

  const sales = await db.select({
    totalAmount: salesEntriesTable.totalAmount,
    discount: salesEntriesTable.discount,
  }).from(salesEntriesTable).where(eq(salesEntriesTable.salesDate, settlementDate));

  const grossSalesAmount = sales.reduce((sum, s) => sum + (s.totalAmount || 0), 0);
  const discountAmount = sales.reduce((sum, s) => sum + (s.discount || 0), 0);
  const netSalesAmount = grossSalesAmount - discountAmount;

  const totalSettlementAmount = lines.reduce((sum: number, l: any) => sum + (Number(l.amount) || 0), 0);
  const differenceAmount = netSalesAmount - totalSettlementAmount;
  let differenceType = "matched";
  if (differenceAmount > 0.01) differenceType = "short";
  else if (differenceAmount < -0.01) differenceType = "excess";

  if (differenceType === "short") {
    res.status(400).json({ error: `Settlement is short by ₹${differenceAmount.toFixed(2)}. Settlement total must be equal to or greater than net sales.` });
    return;
  }

  const userId = (req as any).userId || null;

  const [settlement] = await db.insert(dailySalesSettlementsTable).values({
    settlementDate,
    grossSalesAmount,
    discountAmount,
    netSalesAmount,
    totalSettlementAmount,
    differenceAmount,
    differenceType,
    status: "draft",
    remarks: remarks || null,
    createdBy: userId,
  }).returning();

  for (const line of lines) {
    await db.insert(settlementLinesTable).values({
      settlementId: settlement.id,
      paymentMode: line.paymentMode,
      amount: Number(line.amount) || 0,
      referenceNote: line.referenceNote || null,
    });
  }

  await createAuditLog("settlements", settlement.id, "create", null, settlement);
  res.status(201).json(settlement);
});

router.get("/settlements/:id", authMiddleware, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [settlement] = await db.select().from(dailySalesSettlementsTable).where(eq(dailySalesSettlementsTable.id, id));
  if (!settlement) { res.status(404).json({ error: "Not found" }); return; }

  const lines = await db.select().from(settlementLinesTable).where(eq(settlementLinesTable.settlementId, id));
  res.json({ settlement, lines });
});

router.patch("/settlements/:id", authMiddleware, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [old] = await db.select().from(dailySalesSettlementsTable).where(eq(dailySalesSettlementsTable.id, id));
  if (!old) { res.status(404).json({ error: "Not found" }); return; }
  if (old.status === "verified") { res.status(400).json({ error: "Cannot edit verified settlement" }); return; }

  const { settlementDate, remarks, lines } = req.body;
  if (settlementDate) { const dateErr = validateNotFutureDate(settlementDate, "Settlement date"); if (dateErr) { res.status(400).json({ error: dateErr }); return; } }
  const date = settlementDate || old.settlementDate;

  const sales = await db.select({
    totalAmount: salesEntriesTable.totalAmount,
    discount: salesEntriesTable.discount,
  }).from(salesEntriesTable).where(eq(salesEntriesTable.salesDate, date));

  const grossSalesAmount = sales.reduce((sum, s) => sum + (s.totalAmount || 0), 0);
  const discountAmount = sales.reduce((sum, s) => sum + (s.discount || 0), 0);
  const netSalesAmount = grossSalesAmount - discountAmount;

  let totalSettlementAmount = old.totalSettlementAmount;
  if (lines && Array.isArray(lines)) {
    await db.delete(settlementLinesTable).where(eq(settlementLinesTable.settlementId, id));
    totalSettlementAmount = 0;
    for (const line of lines) {
      const amt = Number(line.amount) || 0;
      totalSettlementAmount += amt;
      await db.insert(settlementLinesTable).values({
        settlementId: id,
        paymentMode: line.paymentMode,
        amount: amt,
        referenceNote: line.referenceNote || null,
      });
    }
  }

  const differenceAmount = netSalesAmount - totalSettlementAmount;
  let differenceType = "matched";
  if (differenceAmount > 0.01) differenceType = "short";
  else if (differenceAmount < -0.01) differenceType = "excess";

  if (differenceType === "short") {
    res.status(400).json({ error: `Settlement is short by ₹${differenceAmount.toFixed(2)}. Settlement total must be equal to or greater than net sales.` });
    return;
  }

  const [settlement] = await db.update(dailySalesSettlementsTable).set({
    settlementDate: date,
    grossSalesAmount,
    discountAmount,
    netSalesAmount,
    totalSettlementAmount,
    differenceAmount,
    differenceType,
    status: "submitted",
    remarks: remarks !== undefined ? remarks : old.remarks,
  }).where(eq(dailySalesSettlementsTable.id, id)).returning();

  await createAuditLog("settlements", id, "update", old, settlement);
  res.json(settlement);
});

router.delete("/settlements/:id", authMiddleware, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [settlement] = await db.delete(dailySalesSettlementsTable).where(eq(dailySalesSettlementsTable.id, id)).returning();
  if (!settlement) { res.status(404).json({ error: "Not found" }); return; }

  await createAuditLog("settlements", id, "delete", settlement, null);
  res.json({ success: true });
});

router.post("/settlements/:id/verify", authMiddleware, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const userId = (req as any).userId || null;
  const userRole = (req as any).userRole;
  if (userRole !== "admin") { res.status(403).json({ error: "Only admin can verify settlements" }); return; }

  const [old] = await db.select().from(dailySalesSettlementsTable).where(eq(dailySalesSettlementsTable.id, id));
  if (!old) { res.status(404).json({ error: "Not found" }); return; }

  const [settlement] = await db.update(dailySalesSettlementsTable).set({
    status: "verified",
    verifiedBy: userId,
    verifiedAt: new Date(),
  }).where(eq(dailySalesSettlementsTable.id, id)).returning();

  await createAuditLog("settlements", id, "verify", old, settlement);
  res.json(settlement);
});

export default router;
