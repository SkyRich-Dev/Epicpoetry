import { Router, type IRouter } from "express";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { db, eodRecordsTable, lockedDatesTable, salesInvoicesTable, expensesTable, pettyCashLedgerTable } from "@workspace/db";
import { authMiddleware, adminOnly, managerOrAdmin } from "../lib/auth";
import { createAuditLog } from "../lib/audit";

const router: IRouter = Router();

function round2(n: number) { return Math.round((n || 0) * 100) / 100; }

// ─── Check if date is locked ──────────────────────────────────────────────────

export async function isDateLocked(date: string): Promise<boolean> {
  const [lock] = await db.select().from(lockedDatesTable)
    .where(and(eq(lockedDatesTable.lockedDate, date), eq(lockedDatesTable.unlocked, false)));
  return !!lock;
}

// ─── Get EOD checklist ────────────────────────────────────────────────────────

router.get("/eod/checklist", authMiddleware, async (req, res): Promise<void> => {
  try {
    const date = (req.query.date as string) || new Date().toISOString().split("T")[0];
    // Check unverified invoices
    const unverifiedInvoices = await db.select({ id: salesInvoicesTable.id })
      .from(salesInvoicesTable)
      .where(and(eq(salesInvoicesTable.salesDate, date), eq(salesInvoicesTable.verified, false)));
    // Check existing EOD
    const [existingEod] = await db.select().from(eodRecordsTable).where(eq(eodRecordsTable.eodDate, date));
    res.json({
      date,
      unverifiedInvoices: unverifiedInvoices.length,
      settlementDone: existingEod?.status === "approved",
      eodStatus: existingEod?.status || "open",
      canClose: unverifiedInvoices.length === 0,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Get EOD record ───────────────────────────────────────────────────────────

router.get("/eod", authMiddleware, async (req, res): Promise<void> => {
  try {
    const { date } = req.query as any;
    if (date) {
      const [eod] = await db.select().from(eodRecordsTable).where(eq(eodRecordsTable.eodDate, date));
      res.json(eod || null);
    } else {
      const eods = await db.select().from(eodRecordsTable).orderBy(desc(eodRecordsTable.eodDate));
      res.json(eods);
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Initiate / Update EOD ────────────────────────────────────────────────────

router.post("/eod/initiate", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
  try {
    const date = (req.body.date as string) || new Date().toISOString().split("T")[0];
    // Auto-calculate system totals
    const invoices = await db.select({
      finalAmount: salesInvoicesTable.finalAmount,
      paymentMode: salesInvoicesTable.paymentMode,
    }).from(salesInvoicesTable)
      .where(and(eq(salesInvoicesTable.salesDate, date), eq(salesInvoicesTable.verified, true)));
    let totalSalesSystem = 0, cashSales = 0, cardSales = 0, upiSales = 0;
    for (const inv of invoices) {
      const amt = inv.finalAmount || 0;
      totalSalesSystem = round2(totalSalesSystem + amt);
      const pm = (inv.paymentMode || "").toLowerCase();
      if (pm.includes("cash")) cashSales = round2(cashSales + amt);
      else if (pm.includes("card")) cardSales = round2(cardSales + amt);
      else if (pm.includes("upi")) upiSales = round2(upiSales + amt);
    }
    // Expenses
    const expResult = await db.select({ total: sql<number>`COALESCE(SUM(total_amount),0)` })
      .from(expensesTable)
      .where(and(eq(expensesTable.expenseDate, date), eq(expensesTable.verified, true)));
    const totalExpenses = round2(Number(expResult[0]?.total || 0));
    // Petty cash balance
    const pcResult = await db.select({ balance: sql<number>`COALESCE(SUM(CASE WHEN transaction_type='receipt' THEN amount ELSE -amount END),0)` })
      .from(pettyCashLedgerTable);
    const pettyCashExpected = round2(Number(pcResult[0]?.balance || 0));
    const existing = await db.select().from(eodRecordsTable).where(eq(eodRecordsTable.eodDate, date));
    let eod;
    if (existing.length > 0) {
      [eod] = await db.update(eodRecordsTable)
        .set({ totalSalesSystem, totalInvoices: invoices.length, cashSalesSystem: cashSales, cardSalesSystem: cardSales, upiSalesSystem: upiSales, totalExpenses, pettyCashExpected, status: "pending" })
        .where(eq(eodRecordsTable.eodDate, date))
        .returning();
    } else {
      [eod] = await db.insert(eodRecordsTable).values({
        eodDate: date, status: "pending",
        totalSalesSystem, totalInvoices: invoices.length,
        cashSalesSystem: cashSales, cardSalesSystem: cardSales, upiSalesSystem: upiSales,
        totalExpenses, pettyCashExpected,
      }).returning();
    }
    res.status(201).json(eod);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Submit Cash Count ────────────────────────────────────────────────────────

router.post("/eod/cash-count", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
  try {
    const { date, denominations, cashPhysical, cardPhysical = 0, upiPhysical = 0, pettyCashPhysical = 0, notes } = req.body;
    if (!date) { res.status(400).json({ error: "Date required" }); return; }
    const [eod] = await db.select().from(eodRecordsTable).where(eq(eodRecordsTable.eodDate, date));
    if (!eod) { res.status(404).json({ error: "EOD record not found. Initiate EOD first." }); return; }
    const cashVariance = round2(cashPhysical - eod.cashSalesSystem);
    const [updated] = await db.update(eodRecordsTable)
      .set({ cashPhysical, cardPhysical, upiPhysical, pettyCashPhysical, cashVariance, denominations, notes })
      .where(eq(eodRecordsTable.eodDate, date))
      .returning();
    res.json({ ...updated, cashVarianceLabel: cashVariance > 0 ? "Over" : cashVariance < 0 ? "Short" : "Match" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Approve EOD and lock the day ─────────────────────────────────────────────

router.post("/eod/approve", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
  try {
    const { date } = req.body;
    if (!date) { res.status(400).json({ error: "Date required" }); return; }
    const [eod] = await db.select().from(eodRecordsTable).where(eq(eodRecordsTable.eodDate, date));
    if (!eod) { res.status(404).json({ error: "EOD record not found" }); return; }
    const [approvedEod] = await db.update(eodRecordsTable)
      .set({ status: "approved", closedBy: (req as any).userId, closedAt: new Date() })
      .where(eq(eodRecordsTable.eodDate, date))
      .returning();
    // Lock the date
    const existing = await db.select().from(lockedDatesTable).where(eq(lockedDatesTable.lockedDate, date));
    if (existing.length === 0) {
      await db.insert(lockedDatesTable).values({ lockedDate: date, lockedBy: (req as any).userId });
    } else {
      await db.update(lockedDatesTable).set({ unlocked: false, unlockReason: null }).where(eq(lockedDatesTable.lockedDate, date));
    }
    await createAuditLog("eod_records", approvedEod.id, "approve", { status: "pending" }, { status: "approved" }, String((req as any).userId));
    res.json({ ...approvedEod, locked: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Unlock a locked date (admin only) ───────────────────────────────────────

router.post("/eod/unlock", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  try {
    const { date, reason } = req.body;
    if (!date || !reason) { res.status(400).json({ error: "Date and reason are required" }); return; }
    const [lock] = await db.update(lockedDatesTable)
      .set({ unlocked: true, unlockReason: reason })
      .where(eq(lockedDatesTable.lockedDate, date))
      .returning();
    if (!lock) { res.status(404).json({ error: "No locked date record found" }); return; }
    await createAuditLog("locked_dates", lock.id, "unlock", { unlocked: false }, { unlocked: true, reason }, String((req as any).userId));
    res.json({ success: true, date, unlocked: true, reason });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Check if date is locked (utility endpoint) ───────────────────────────────

router.get("/eod/lock-status", authMiddleware, async (req, res): Promise<void> => {
  try {
    const date = req.query.date as string;
    if (!date) { res.status(400).json({ error: "Date required" }); return; }
    const locked = await isDateLocked(date);
    res.json({ date, locked });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
