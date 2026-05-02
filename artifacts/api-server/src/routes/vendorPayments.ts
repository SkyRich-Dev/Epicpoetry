import { Router, type IRouter } from "express";
import { eq, and, gte, lte, sql, desc, asc } from "drizzle-orm";
import {
  db, vendorPaymentsTable, vendorPaymentAllocationsTable, vendorLedgerTable,
  purchasesTable, vendorsTable, expensesTable, pettyCashLedgerTable, systemConfigTable
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

  const purchaseAllocs = await db.select({
    id: vendorPaymentAllocationsTable.id,
    kind: sql<string>`'purchase'`,
    purchaseId: vendorPaymentAllocationsTable.purchaseId,
    expenseId: vendorPaymentAllocationsTable.expenseId,
    billNumber: purchasesTable.purchaseNumber,
    invoiceNumber: purchasesTable.invoiceNumber,
    billAmount: purchasesTable.totalAmount,
    allocatedAmount: vendorPaymentAllocationsTable.allocatedAmount,
  }).from(vendorPaymentAllocationsTable)
    .leftJoin(purchasesTable, eq(vendorPaymentAllocationsTable.purchaseId, purchasesTable.id))
    .where(and(
      eq(vendorPaymentAllocationsTable.vendorPaymentId, id),
      sql`${vendorPaymentAllocationsTable.purchaseId} IS NOT NULL`,
    ));

  const expenseAllocs = await db.select({
    id: vendorPaymentAllocationsTable.id,
    kind: sql<string>`'expense'`,
    purchaseId: vendorPaymentAllocationsTable.purchaseId,
    expenseId: vendorPaymentAllocationsTable.expenseId,
    billNumber: expensesTable.expenseNumber,
    invoiceNumber: sql<string | null>`NULL`,
    billAmount: expensesTable.totalAmount,
    allocatedAmount: vendorPaymentAllocationsTable.allocatedAmount,
  }).from(vendorPaymentAllocationsTable)
    .leftJoin(expensesTable, eq(vendorPaymentAllocationsTable.expenseId, expensesTable.id))
    .where(and(
      eq(vendorPaymentAllocationsTable.vendorPaymentId, id),
      sql`${vendorPaymentAllocationsTable.expenseId} IS NOT NULL`,
    ));

  const allocations = [...purchaseAllocs, ...expenseAllocs];

  res.json({ ...payment, allocations });
});

// Helper: rounds to 2 dp, used everywhere we touch money to dodge fp drift.
const round2 = (n: number) => Math.round(n * 100) / 100;
const isPosFinite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

// Take a row-level lock on the vendor row inside a transaction so that any
// concurrent transaction trying to write to vendor_ledger / vendor_payments /
// posted-expense rows for the same vendor is forced to serialize. Without this
// two payments for the same vendor could read the same prior ledger balance
// and write inconsistent runningBalance values.
async function lockVendor(tx: any, vendorId: number): Promise<void> {
  await tx
    .select({ id: vendorsTable.id })
    .from(vendorsTable)
    .where(eq(vendorsTable.id, vendorId))
    .for("update");
}

router.post("/vendor-payments", authMiddleware, async (req, res): Promise<void> => {
  const { vendorId, paymentDate, paymentMethod, transactionReference, totalAmount, remarks, allocations } = req.body;
  if (!vendorId || !paymentDate || !paymentMethod) {
    res.status(400).json({ error: "vendorId, paymentDate, paymentMethod required" }); return;
  }
  if (!isPosFinite(totalAmount)) {
    res.status(400).json({ error: "totalAmount must be a positive finite number" }); return;
  }
  const dateErr = validateNotFutureDate(paymentDate, "Payment date");
  if (dateErr) { res.status(400).json({ error: dateErr }); return; }

  // Pre-validate + aggregate allocations OUTSIDE the tx to fail fast with a clean
  // 400 on bad input. Duplicates targeting the same bill in one request are summed
  // up first so over-allocation can't sneak through; then we compare the aggregate
  // (not each row) against the row's pending balance inside the locked transaction.
  type Bucket = { kind: "purchase" | "expense"; id: number; amount: number };
  const buckets = new Map<string, Bucket>();
  let allocTotal = 0;

  // Allocations are mandatory. A vendor payment with no allocations would credit
  // the vendor ledger without reducing any bill / expense pending — which is
  // double-accounting (the original purchase or expense already created the
  // liability). If we ever want to support vendor advances, model them as a
  // separate "advance" table, not as un-allocated payments.
  if (!Array.isArray(allocations) || allocations.length === 0) {
    res.status(400).json({ error: "allocations must be a non-empty array" }); return;
  }
  {
    for (const alloc of allocations) {
      const hasPurchase = alloc?.purchaseId != null;
      const hasExpense = alloc?.expenseId != null;
      if (hasPurchase === hasExpense) {
        res.status(400).json({ error: "Each allocation needs exactly one of purchaseId or expenseId" }); return;
      }
      if (!isPosFinite(alloc.amount)) {
        res.status(400).json({ error: "Each allocation amount must be a positive finite number" }); return;
      }
      const kind: "purchase" | "expense" = hasPurchase ? "purchase" : "expense";
      const id = Number(hasPurchase ? alloc.purchaseId : alloc.expenseId);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "Allocation target id must be a positive integer" }); return;
      }
      const key = `${kind}-${id}`;
      const existing = buckets.get(key);
      const amount = round2(alloc.amount);
      if (existing) existing.amount = round2(existing.amount + amount);
      else buckets.set(key, { kind, id, amount });
      allocTotal = round2(allocTotal + amount);
    }
    if (Math.abs(allocTotal - totalAmount) > 0.01) {
      res.status(400).json({ error: `Allocation total (${allocTotal}) does not match payment amount (${totalAmount})` }); return;
    }
  }

  const paymentNo = await generateCode("VPAY", "vendor_payments");

  // Single transaction: lock target bills/expenses FOR UPDATE so two concurrent
  // payments cannot both validate against the same pending amount and overpay.
  // Any failure (validation or insert) rolls back everything atomically.
  let payment: typeof vendorPaymentsTable.$inferSelect;
  try {
    payment = await db.transaction(async (tx) => {
      // Serialize all writes against this vendor (ledger + bills + expenses)
      // so that the prior-balance read for runningBalance cannot race with
      // another payment / posted expense for the same vendor.
      await lockVendor(tx, vendorId);

      // Validate & lock each unique target inside the tx using SELECT ... FOR UPDATE
      // so two concurrent payments cannot both validate against the same pending
      // amount and overpay.
      for (const b of buckets.values()) {
        if (b.kind === "purchase") {
          const [bill] = await tx.select().from(purchasesTable)
            .where(eq(purchasesTable.id, b.id))
            .for("update");
          if (!bill) throw Object.assign(new Error(`Bill ${b.id} not found`), { httpStatus: 400 });
          if (bill.vendorId !== vendorId) {
            throw Object.assign(new Error(`Bill ${b.id} belongs to different vendor`), { httpStatus: 400 });
          }
          if (b.amount > bill.pendingAmount + 0.01) {
            throw Object.assign(
              new Error(`Allocation ${b.amount} exceeds pending ${bill.pendingAmount} for bill ${bill.purchaseNumber}`),
              { httpStatus: 400 },
            );
          }
        } else {
          const [exp] = await tx.select().from(expensesTable)
            .where(eq(expensesTable.id, b.id))
            .for("update");
          if (!exp) throw Object.assign(new Error(`Expense ${b.id} not found`), { httpStatus: 400 });
          if (!exp.postedToVendor || exp.vendorId !== vendorId) {
            throw Object.assign(new Error(`Expense ${b.id} is not posted to this vendor portal`), { httpStatus: 400 });
          }
          if (b.amount > exp.pendingAmount + 0.01) {
            throw Object.assign(
              new Error(`Allocation ${b.amount} exceeds pending ${exp.pendingAmount} for expense ${exp.expenseNumber}`),
              { httpStatus: 400 },
            );
          }
        }
      }

      const [created] = await tx.insert(vendorPaymentsTable).values({
        paymentNo, vendorId, paymentDate, paymentMethod, transactionReference,
        totalAmount: round2(totalAmount), remarks, createdBy: (req as any).userId,
      }).returning();

      for (const b of buckets.values()) {
        await tx.insert(vendorPaymentAllocationsTable).values({
          vendorPaymentId: created.id,
          purchaseId: b.kind === "purchase" ? b.id : null,
          expenseId: b.kind === "expense" ? b.id : null,
          allocatedAmount: b.amount,
        });

        if (b.kind === "purchase") {
          const [bill] = await tx.select().from(purchasesTable).where(eq(purchasesTable.id, b.id));
          const newPaid = round2(bill.paidAmount + b.amount);
          const newPending = Math.max(0, round2(bill.totalAmount - newPaid));
          const newStatus = newPending <= 0.01 ? "fully_paid" : "partially_paid";
          await tx.update(purchasesTable).set({
            paidAmount: newPaid,
            pendingAmount: newPending,
            paymentStatus: newStatus,
            lastPaymentDate: paymentDate,
          }).where(eq(purchasesTable.id, b.id));
        } else {
          const [exp] = await tx.select().from(expensesTable).where(eq(expensesTable.id, b.id));
          const newPaid = round2(exp.paidAmount + b.amount);
          const newPending = Math.max(0, round2(exp.totalAmount - newPaid));
          const newStatus = newPending <= 0.01 ? "fully_paid" : "partially_paid";
          await tx.update(expensesTable).set({
            paidAmount: newPaid,
            pendingAmount: newPending,
            vendorPaymentStatus: newStatus,
          }).where(eq(expensesTable.id, b.id));
        }
      }

      const lastLedger = await tx.select().from(vendorLedgerTable)
        .where(eq(vendorLedgerTable.vendorId, vendorId))
        .orderBy(desc(vendorLedgerTable.id))
        .limit(1);
      const prevBalance = lastLedger.length > 0 ? lastLedger[0].runningBalance : 0;

      await tx.insert(vendorLedgerTable).values({
        vendorId,
        transactionDate: paymentDate,
        transactionType: "payment",
        referenceType: "vendor_payment",
        referenceId: created.id,
        debit: 0,
        credit: round2(totalAmount),
        runningBalance: round2(prevBalance - totalAmount),
        description: `Payment ${paymentNo} - ${paymentMethod}`,
      });

      // When a vendor payment is paid out of petty cash, the cash physically
      // leaves the petty-cash drawer — so we MUST mirror it as an expense in
      // the petty_cash_ledger. Without this the petty-cash balance silently
      // disagrees with reality.
      // Concurrency: a postgres transaction-scoped advisory lock serialises
      // every petty-cash insert (this route + the direct /api/petty-cash POST
      // both take the same lock) so two simultaneous requests can't both
      // observe the same balance and overdraw.
      if (paymentMethod === "petty_cash") {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(91234567)`);

        const [vendorRow] = await tx.select({ name: vendorsTable.name })
          .from(vendorsTable)
          .where(eq(vendorsTable.id, vendorId))
          .limit(1);
        const vendorName = vendorRow?.name || `vendor #${vendorId}`;

        const [config] = await tx.select().from(systemConfigTable);
        const opening = Number(config?.pettyCashOpeningBalance || 0);
        const [agg] = await tx.select({
          sum: sql<number>`COALESCE(
            SUM(CASE WHEN transaction_type = 'receipt' THEN amount ELSE 0 END) -
            SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END) +
            SUM(CASE WHEN transaction_type = 'adjustment' THEN amount ELSE 0 END), 0)`
        }).from(pettyCashLedgerTable);
        const pcBalance = round2(opening + Number(agg?.sum || 0));

        if (pcBalance + 0.01 < totalAmount) {
          throw Object.assign(
            new Error(`Insufficient petty cash balance. Available: ₹${pcBalance.toFixed(2)}, requested: ₹${Number(totalAmount).toFixed(2)}`),
            { httpStatus: 400 },
          );
        }

        await tx.insert(pettyCashLedgerTable).values({
          transactionDate: paymentDate,
          transactionType: "expense",
          amount: round2(totalAmount),
          method: "cash",
          counterpartyName: vendorName,
          category: "vendor_payment",
          linkedExpenseId: null,
          description: `Vendor payment ${paymentNo} to ${vendorName}`,
          runningBalance: round2(pcBalance - totalAmount),
          approvalStatus: "approved",
          createdBy: (req as any).userId || null,
        });
      }

      return created;
    });
  } catch (e: any) {
    const status = e?.httpStatus ?? 500;
    res.status(status).json({ error: e?.message || "Failed to record payment" });
    return;
  }

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

  // Pull and lock the payment INSIDE the tx so two concurrent deletes can't
  // both observe the same payment row, both succeed, and write two reversal
  // ledger entries. The first delete locks the row and the second waits then
  // sees no row → 404.
  let deleted: typeof vendorPaymentsTable.$inferSelect | null = null;
  try {
    deleted = await db.transaction(async (tx) => {
      const [payment] = await tx.select().from(vendorPaymentsTable)
        .where(eq(vendorPaymentsTable.id, id))
        .for("update");
      if (!payment) return null;

      // Serialize per-vendor writes so the reversal ledger row is computed
      // from a stable prior balance.
      await lockVendor(tx, payment.vendorId);

      const allocations = await tx.select().from(vendorPaymentAllocationsTable)
        .where(eq(vendorPaymentAllocationsTable.vendorPaymentId, id));

      for (const alloc of allocations) {
        if (alloc.purchaseId != null) {
          const [bill] = await tx.select().from(purchasesTable)
            .where(eq(purchasesTable.id, alloc.purchaseId))
            .for("update");
          if (bill) {
            const newPaid = Math.max(0, round2(bill.paidAmount - alloc.allocatedAmount));
            const newPending = Math.max(0, round2(bill.totalAmount - newPaid));
            const newStatus = newPaid <= 0.01 ? "unpaid" : "partially_paid";
            await tx.update(purchasesTable).set({
              paidAmount: newPaid,
              pendingAmount: newPending,
              paymentStatus: newStatus,
            }).where(eq(purchasesTable.id, alloc.purchaseId));
          }
        } else if (alloc.expenseId != null) {
          const [exp] = await tx.select().from(expensesTable)
            .where(eq(expensesTable.id, alloc.expenseId))
            .for("update");
          if (exp) {
            const newPaid = Math.max(0, round2(exp.paidAmount - alloc.allocatedAmount));
            const newPending = Math.max(0, round2(exp.totalAmount - newPaid));
            const newStatus = newPaid <= 0.01 ? "unpaid" : "partially_paid";
            await tx.update(expensesTable).set({
              paidAmount: newPaid,
              pendingAmount: newPending,
              vendorPaymentStatus: newStatus,
            }).where(eq(expensesTable.id, alloc.expenseId));
          }
        }
      }

      await tx.delete(vendorPaymentAllocationsTable).where(eq(vendorPaymentAllocationsTable.vendorPaymentId, id));
      await tx.delete(vendorPaymentsTable).where(eq(vendorPaymentsTable.id, id));

      const lastLedger = await tx.select().from(vendorLedgerTable)
        .where(eq(vendorLedgerTable.vendorId, payment.vendorId))
        .orderBy(desc(vendorLedgerTable.id))
        .limit(1);
      const prevBalance = lastLedger.length > 0 ? lastLedger[0].runningBalance : 0;
      await tx.insert(vendorLedgerTable).values({
        vendorId: payment.vendorId,
        transactionDate: new Date().toISOString().split('T')[0],
        transactionType: "reversal",
        referenceType: "vendor_payment",
        referenceId: id,
        debit: payment.totalAmount,
        credit: 0,
        runningBalance: round2(prevBalance + payment.totalAmount),
        description: `Reversal of payment ${payment.paymentNo}`,
      });

      // If the original payment was funded from petty cash we MUST also
      // reverse the petty-cash ledger expense — otherwise deleting a payment
      // restores the vendor's outstanding balance but leaves petty cash
      // permanently short, silently drifting the cash count from reality.
      // Same advisory lock as the create path so the running balance is
      // computed against a stable view of the petty-cash ledger.
      if (payment.paymentMethod === "petty_cash") {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(91234567)`);
        const [config] = await tx.select().from(systemConfigTable);
        const opening = Number(config?.pettyCashOpeningBalance || 0);
        const [agg] = await tx.select({
          sum: sql<number>`COALESCE(
            SUM(CASE WHEN transaction_type = 'receipt' THEN amount ELSE 0 END) -
            SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END) +
            SUM(CASE WHEN transaction_type = 'adjustment' THEN amount ELSE 0 END), 0)`
        }).from(pettyCashLedgerTable);
        const pcBalance = round2(opening + Number(agg?.sum || 0));
        await tx.insert(pettyCashLedgerTable).values({
          transactionDate: new Date().toISOString().split('T')[0],
          transactionType: "receipt",
          amount: round2(payment.totalAmount),
          method: "cash",
          counterpartyName: null,
          category: "vendor_payment_reversal",
          linkedExpenseId: null,
          description: `Reversal of vendor payment ${payment.paymentNo}`,
          runningBalance: round2(pcBalance + payment.totalAmount),
          approvalStatus: "approved",
          createdBy: (req as any).userId || null,
        });
      }

      return payment;
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to delete payment" });
    return;
  }

  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("vendor_payments", id, "delete", deleted, null);
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

  const purchaseBills = await db.select().from(purchasesTable)
    .where(eq(purchasesTable.vendorId, vendorId))
    .orderBy(desc(purchasesTable.createdAt));

  const expenseBillsRaw = await db.select().from(expensesTable)
    .where(and(eq(expensesTable.vendorId, vendorId), eq(expensesTable.postedToVendor, true)))
    .orderBy(desc(expensesTable.createdAt));

  // Normalize expense rows so the UI can render them in the same bills table.
  const expenseBills = expenseBillsRaw.map(e => ({
    id: e.id,
    kind: "expense" as const,
    purchaseNumber: e.expenseNumber,
    purchaseDate: e.expenseDate,
    invoiceNumber: null as string | null,
    vendorInvoiceNumber: null as string | null,
    dueDate: e.dueDate,
    totalAmount: e.totalAmount,
    paidAmount: e.paidAmount,
    pendingAmount: e.pendingAmount,
    paymentStatus: e.vendorPaymentStatus,
    notes: e.description,
    createdAt: e.createdAt,
  }));
  const purchaseBillsMarked = purchaseBills.map(b => ({ ...b, kind: "purchase" as const }));
  const bills = [...purchaseBillsMarked, ...expenseBills].sort(
    (a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime()
  );

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
  // Posted-to-vendor expenses are real liabilities and must roll up into the
  // vendor list page's totals/overdue cards alongside purchase bills.
  const expenseBills = await db.select().from(expensesTable)
    .where(eq(expensesTable.postedToVendor, true));
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

  for (const e of expenseBills) {
    if (e.vendorId == null) continue;
    const s = summaries[e.vendorId];
    if (!s) continue;
    s.totalPurchase += e.totalAmount;
    s.totalPaid += e.paidAmount;
    s.totalPending += e.pendingAmount;
    s.totalBills += 1;
    if (e.dueDate && e.dueDate < today && e.pendingAmount > 0) {
      s.overdueBillsCount += 1;
      s.overdueAmount += e.pendingAmount;
    }
    const ed = e.expenseDate;
    if (!s.lastPurchaseDate || ed > s.lastPurchaseDate) s.lastPurchaseDate = ed;
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
