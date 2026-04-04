import { Router, type IRouter } from "express";
import { eq, and, gte, lte, sql, desc, asc } from "drizzle-orm";
import {
  db, vendorPaymentsTable, vendorPaymentAllocationsTable, vendorLedgerTable,
  purchasesTable, vendorsTable
} from "@workspace/db";
import { authMiddleware, adminOnly } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { generateCode } from "../lib/codeGenerator";
import { validateNotFutureDate } from "../lib/dateValidation";
import multer from "multer";
import path from "path";
import fs from "fs";

const PROOF_DIR = path.join(process.cwd(), "uploads", "vendor-proofs");
fs.mkdirSync(PROOF_DIR, { recursive: true });
const proofUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PROOF_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    cb(null, allowed.includes(file.mimetype));
  },
});

const router: IRouter = Router();

router.get("/vendor-payments", authMiddleware, async (req, res): Promise<void> => {
  const conditions: any[] = [];
  if (req.query.vendorId) conditions.push(eq(vendorPaymentsTable.vendorId, Number(req.query.vendorId)));
  if (req.query.fromDate) conditions.push(gte(vendorPaymentsTable.paymentDate, req.query.fromDate as string));
  if (req.query.toDate) conditions.push(lte(vendorPaymentsTable.paymentDate, req.query.toDate as string));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const query = db.select({
    id: vendorPaymentsTable.id,
    paymentNo: vendorPaymentsTable.paymentNo,
    vendorId: vendorPaymentsTable.vendorId,
    vendorName: vendorsTable.name,
    paymentDate: vendorPaymentsTable.paymentDate,
    paymentMethod: vendorPaymentsTable.paymentMethod,
    transactionReference: vendorPaymentsTable.transactionReference,
    totalAmount: vendorPaymentsTable.totalAmount,
    remarks: vendorPaymentsTable.remarks,
    paymentProof: vendorPaymentsTable.paymentProof,
    createdAt: vendorPaymentsTable.createdAt,
  }).from(vendorPaymentsTable)
    .leftJoin(vendorsTable, eq(vendorPaymentsTable.vendorId, vendorsTable.id));

  const payments = whereClause
    ? await query.where(whereClause).orderBy(desc(vendorPaymentsTable.createdAt))
    : await query.orderBy(desc(vendorPaymentsTable.createdAt));
  res.json(payments);
});

router.get("/vendor-payments/:id", authMiddleware, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [payment] = await db.select({
    id: vendorPaymentsTable.id,
    paymentNo: vendorPaymentsTable.paymentNo,
    vendorId: vendorPaymentsTable.vendorId,
    vendorName: vendorsTable.name,
    paymentDate: vendorPaymentsTable.paymentDate,
    paymentMethod: vendorPaymentsTable.paymentMethod,
    transactionReference: vendorPaymentsTable.transactionReference,
    totalAmount: vendorPaymentsTable.totalAmount,
    remarks: vendorPaymentsTable.remarks,
    paymentProof: vendorPaymentsTable.paymentProof,
    createdAt: vendorPaymentsTable.createdAt,
  }).from(vendorPaymentsTable)
    .leftJoin(vendorsTable, eq(vendorPaymentsTable.vendorId, vendorsTable.id))
    .where(eq(vendorPaymentsTable.id, id));
  if (!payment) { res.status(404).json({ error: "Not found" }); return; }

  const allocations = await db.select({
    id: vendorPaymentAllocationsTable.id,
    purchaseId: vendorPaymentAllocationsTable.purchaseId,
    purchaseNumber: purchasesTable.purchaseNumber,
    invoiceNumber: purchasesTable.invoiceNumber,
    billAmount: purchasesTable.totalAmount,
    allocatedAmount: vendorPaymentAllocationsTable.allocatedAmount,
  }).from(vendorPaymentAllocationsTable)
    .leftJoin(purchasesTable, eq(vendorPaymentAllocationsTable.purchaseId, purchasesTable.id))
    .where(eq(vendorPaymentAllocationsTable.vendorPaymentId, id));

  res.json({ ...payment, allocations });
});

router.post("/vendor-payments", authMiddleware, async (req, res): Promise<void> => {
  const { vendorId, paymentDate, paymentMethod, transactionReference, totalAmount, remarks, allocations } = req.body;
  if (!vendorId || !paymentDate || !paymentMethod || !totalAmount) {
    res.status(400).json({ error: "vendorId, paymentDate, paymentMethod, totalAmount required" }); return;
  }
  const dateErr = validateNotFutureDate(paymentDate, "Payment date");
  if (dateErr) { res.status(400).json({ error: dateErr }); return; }

  if (allocations && Array.isArray(allocations)) {
    let allocTotal = 0;
    for (const alloc of allocations) {
      const [bill] = await db.select().from(purchasesTable).where(eq(purchasesTable.id, alloc.purchaseId));
      if (!bill) { res.status(400).json({ error: `Bill ${alloc.purchaseId} not found` }); return; }
      if (bill.vendorId !== vendorId) { res.status(400).json({ error: `Bill ${alloc.purchaseId} belongs to different vendor` }); return; }
      if (alloc.amount > bill.pendingAmount + 0.01) {
        res.status(400).json({ error: `Allocation ${alloc.amount} exceeds pending ${bill.pendingAmount} for bill ${bill.purchaseNumber}` }); return;
      }
      allocTotal += alloc.amount;
    }
    if (Math.abs(allocTotal - totalAmount) > 0.01) {
      res.status(400).json({ error: `Allocation total (${allocTotal}) does not match payment amount (${totalAmount})` }); return;
    }
  }

  const paymentNo = await generateCode("VPAY", "vendor_payments");
  const [payment] = await db.insert(vendorPaymentsTable).values({
    paymentNo, vendorId, paymentDate, paymentMethod, transactionReference,
    totalAmount, remarks, createdBy: (req as any).userId,
  }).returning();

  if (allocations && Array.isArray(allocations)) {
    for (const alloc of allocations) {
      await db.insert(vendorPaymentAllocationsTable).values({
        vendorPaymentId: payment.id,
        purchaseId: alloc.purchaseId,
        allocatedAmount: alloc.amount,
      });

      const [bill] = await db.select().from(purchasesTable).where(eq(purchasesTable.id, alloc.purchaseId));
      const newPaid = bill.paidAmount + alloc.amount;
      const newPending = bill.totalAmount - newPaid;
      const newStatus = newPending <= 0.01 ? "fully_paid" : "partially_paid";
      await db.update(purchasesTable).set({
        paidAmount: Math.round(newPaid * 100) / 100,
        pendingAmount: Math.max(0, Math.round(newPending * 100) / 100),
        paymentStatus: newStatus,
        lastPaymentDate: paymentDate,
      }).where(eq(purchasesTable.id, alloc.purchaseId));
    }
  }

  const lastLedger = await db.select().from(vendorLedgerTable)
    .where(eq(vendorLedgerTable.vendorId, vendorId))
    .orderBy(desc(vendorLedgerTable.id))
    .limit(1);
  const prevBalance = lastLedger.length > 0 ? lastLedger[0].runningBalance : 0;

  await db.insert(vendorLedgerTable).values({
    vendorId,
    transactionDate: paymentDate,
    transactionType: "payment",
    referenceType: "vendor_payment",
    referenceId: payment.id,
    debit: 0,
    credit: totalAmount,
    runningBalance: prevBalance - totalAmount,
    description: `Payment ${paymentNo} - ${paymentMethod}`,
  });

  await createAuditLog("vendor_payments", payment.id, "create", null, { paymentNo, totalAmount });
  res.status(201).json(payment);
});

router.post("/vendor-payments/:id/upload-proof", authMiddleware, proofUpload.single("file"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(vendorPaymentsTable).where(eq(vendorPaymentsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!req.file) { res.status(400).json({ error: "No file" }); return; }
  const proofUrl = `/api/uploads/vendor-proofs/${req.file.filename}`;
  const [updated] = await db.update(vendorPaymentsTable).set({ paymentProof: proofUrl }).where(eq(vendorPaymentsTable.id, id)).returning();
  await createAuditLog("vendor_payments", id, "proof_upload", null, { proofUrl });
  res.json(updated);
});

router.delete("/vendor-payments/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [payment] = await db.select().from(vendorPaymentsTable).where(eq(vendorPaymentsTable.id, id));
  if (!payment) { res.status(404).json({ error: "Not found" }); return; }

  const allocations = await db.select().from(vendorPaymentAllocationsTable)
    .where(eq(vendorPaymentAllocationsTable.vendorPaymentId, id));

  for (const alloc of allocations) {
    const [bill] = await db.select().from(purchasesTable).where(eq(purchasesTable.id, alloc.purchaseId));
    if (bill) {
      const newPaid = Math.max(0, bill.paidAmount - alloc.allocatedAmount);
      const newPending = bill.totalAmount - newPaid;
      const newStatus = newPaid <= 0.01 ? "unpaid" : "partially_paid";
      await db.update(purchasesTable).set({
        paidAmount: Math.round(newPaid * 100) / 100,
        pendingAmount: Math.round(newPending * 100) / 100,
        paymentStatus: newStatus,
      }).where(eq(purchasesTable.id, alloc.purchaseId));
    }
  }

  await db.delete(vendorPaymentAllocationsTable).where(eq(vendorPaymentAllocationsTable.vendorPaymentId, id));
  await db.delete(vendorPaymentsTable).where(eq(vendorPaymentsTable.id, id));

  const lastLedger = await db.select().from(vendorLedgerTable)
    .where(eq(vendorLedgerTable.vendorId, payment.vendorId))
    .orderBy(desc(vendorLedgerTable.id))
    .limit(1);
  const prevBalance = lastLedger.length > 0 ? lastLedger[0].runningBalance : 0;
  await db.insert(vendorLedgerTable).values({
    vendorId: payment.vendorId,
    transactionDate: new Date().toISOString().split('T')[0],
    transactionType: "reversal",
    referenceType: "vendor_payment",
    referenceId: id,
    debit: payment.totalAmount,
    credit: 0,
    runningBalance: prevBalance + payment.totalAmount,
    description: `Reversal of payment ${payment.paymentNo}`,
  });

  await createAuditLog("vendor_payments", id, "delete", payment, null);
  res.json({ success: true });
});

router.get("/vendor-ledger/:vendorId", authMiddleware, async (req, res): Promise<void> => {
  const vendorId = Number(req.params.vendorId);
  const conditions: any[] = [eq(vendorLedgerTable.vendorId, vendorId)];
  if (req.query.fromDate) conditions.push(gte(vendorLedgerTable.transactionDate, req.query.fromDate as string));
  if (req.query.toDate) conditions.push(lte(vendorLedgerTable.transactionDate, req.query.toDate as string));

  const entries = await db.select().from(vendorLedgerTable)
    .where(and(...conditions))
    .orderBy(asc(vendorLedgerTable.id));
  res.json(entries);
});

router.get("/vendor-detail/:vendorId", authMiddleware, async (req, res): Promise<void> => {
  const vendorId = Number(req.params.vendorId);
  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, vendorId));
  if (!vendor) { res.status(404).json({ error: "Not found" }); return; }

  const bills = await db.select().from(purchasesTable)
    .where(eq(purchasesTable.vendorId, vendorId))
    .orderBy(desc(purchasesTable.createdAt));

  const payments = await db.select({
    id: vendorPaymentsTable.id,
    paymentNo: vendorPaymentsTable.paymentNo,
    paymentDate: vendorPaymentsTable.paymentDate,
    paymentMethod: vendorPaymentsTable.paymentMethod,
    totalAmount: vendorPaymentsTable.totalAmount,
    transactionReference: vendorPaymentsTable.transactionReference,
    paymentProof: vendorPaymentsTable.paymentProof,
    createdAt: vendorPaymentsTable.createdAt,
  }).from(vendorPaymentsTable)
    .where(eq(vendorPaymentsTable.vendorId, vendorId))
    .orderBy(desc(vendorPaymentsTable.createdAt));

  const totalPurchase = bills.reduce((s, b) => s + b.totalAmount, 0);
  const totalPaid = bills.reduce((s, b) => s + b.paidAmount, 0);
  const totalPending = bills.reduce((s, b) => s + b.pendingAmount, 0);
  const totalBills = bills.length;

  const today = new Date().toISOString().split('T')[0];
  const overdueBills = bills.filter(b => b.dueDate && b.dueDate < today && b.pendingAmount > 0);
  const overdueAmount = overdueBills.reduce((s, b) => s + b.pendingAmount, 0);

  const paymentDates = payments.map(p => new Date(p.paymentDate).getTime());
  const purchaseDates = bills.map(b => new Date(b.purchaseDate).getTime());
  const lastPurchaseDate = purchaseDates.length > 0 ? new Date(Math.max(...purchaseDates)).toISOString().split('T')[0] : null;
  const lastPaymentDate = paymentDates.length > 0 ? new Date(Math.max(...paymentDates)).toISOString().split('T')[0] : null;

  const aging = { current: 0, days1_7: 0, days8_15: 0, days16_30: 0, days30plus: 0 };
  for (const b of bills) {
    if (b.pendingAmount <= 0) continue;
    if (!b.dueDate || b.dueDate >= today) { aging.current += b.pendingAmount; continue; }
    const overdueDays = Math.floor((new Date(today).getTime() - new Date(b.dueDate).getTime()) / 86400000);
    if (overdueDays <= 7) aging.days1_7 += b.pendingAmount;
    else if (overdueDays <= 15) aging.days8_15 += b.pendingAmount;
    else if (overdueDays <= 30) aging.days16_30 += b.pendingAmount;
    else aging.days30plus += b.pendingAmount;
  }

  res.json({
    vendor,
    summary: {
      totalPurchase: Math.round(totalPurchase * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
      totalPending: Math.round(totalPending * 100) / 100,
      totalBills,
      overdueBillsCount: overdueBills.length,
      overdueAmount: Math.round(overdueAmount * 100) / 100,
      lastPurchaseDate,
      lastPaymentDate,
    },
    aging,
    recentBills: bills.slice(0, 20),
    recentPayments: payments.slice(0, 20),
  });
});

router.get("/vendor-summaries", authMiddleware, async (req, res): Promise<void> => {
  const vendors = await db.select({ id: vendorsTable.id }).from(vendorsTable);
  const bills = await db.select().from(purchasesTable);
  const payments = await db.select({
    vendorId: vendorPaymentsTable.vendorId,
    paymentDate: vendorPaymentsTable.paymentDate,
  }).from(vendorPaymentsTable);

  const today = new Date().toISOString().split('T')[0];
  const summaries: Record<number, any> = {};

  for (const v of vendors) {
    summaries[v.id] = { totalPurchase: 0, totalPaid: 0, totalPending: 0, totalBills: 0, overdueBillsCount: 0, overdueAmount: 0, lastPurchaseDate: null, lastPaymentDate: null };
  }

  for (const b of bills) {
    const s = summaries[b.vendorId];
    if (!s) continue;
    s.totalPurchase += b.totalAmount;
    s.totalPaid += b.paidAmount;
    s.totalPending += b.pendingAmount;
    s.totalBills += 1;
    if (b.dueDate && b.dueDate < today && b.pendingAmount > 0) {
      s.overdueBillsCount += 1;
      s.overdueAmount += b.pendingAmount;
    }
    const pd = b.purchaseDate;
    if (!s.lastPurchaseDate || pd > s.lastPurchaseDate) s.lastPurchaseDate = pd;
  }

  for (const p of payments) {
    const s = summaries[p.vendorId];
    if (!s) continue;
    if (!s.lastPaymentDate || p.paymentDate > s.lastPaymentDate) s.lastPaymentDate = p.paymentDate;
  }

  for (const id in summaries) {
    const s = summaries[id];
    s.totalPurchase = Math.round(s.totalPurchase * 100) / 100;
    s.totalPaid = Math.round(s.totalPaid * 100) / 100;
    s.totalPending = Math.round(s.totalPending * 100) / 100;
    s.overdueAmount = Math.round(s.overdueAmount * 100) / 100;
  }

  res.json(summaries);
});

router.get("/uploads/vendor-proofs/:filename", authMiddleware, async (req, res): Promise<void> => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(PROOF_DIR, filename);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(PROOF_DIR))) { res.status(403).json({ error: "Forbidden" }); return; }
  if (!fs.existsSync(resolved)) { res.status(404).json({ error: "File not found" }); return; }
  res.sendFile(resolved);
});

export default router;
