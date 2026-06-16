import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, kotOrdersTable, kotItemsTable, restaurantTablesTable, salesInvoicesTable } from "@workspace/db";
import { authMiddleware, managerOrAdmin } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { generateCode } from "../lib/codeGenerator";

const router: IRouter = Router();

// ─── KOT List ─────────────────────────────────────────────────────────────────

router.get("/kot-orders", authMiddleware, async (req, res): Promise<void> => {
  try {
    const { status, date } = req.query as any;
    let query = db.select().from(kotOrdersTable) as any;
    const conditions: any[] = [];
    if (status) conditions.push(eq(kotOrdersTable.status, status));
    if (conditions.length) query = query.where(and(...conditions));
    const kots = await query.orderBy(desc(kotOrdersTable.createdAt));
    // Attach items for each KOT
    const result = await Promise.all(kots.map(async (kot: any) => {
      const items = await db.select().from(kotItemsTable).where(eq(kotItemsTable.kotId, kot.id));
      return { ...kot, items };
    }));
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/kot-orders/:id", authMiddleware, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [kot] = await db.select().from(kotOrdersTable).where(eq(kotOrdersTable.id, id));
    if (!kot) { res.status(404).json({ error: "KOT not found" }); return; }
    const items = await db.select().from(kotItemsTable).where(eq(kotItemsTable.kotId, id));
    res.json({ ...kot, items });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Create KOT ───────────────────────────────────────────────────────────────

router.post("/kot-orders", authMiddleware, async (req, res): Promise<void> => {
  try {
    const { invoiceId, tableId, tableName, notes, items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "At least one item is required" }); return;
    }
    const kotNumber = await generateCode("KOT", "kot_orders", db);
    const [kot] = await db.insert(kotOrdersTable).values({
      kotNumber, invoiceId, tableId, tableName, notes, status: "new",
      createdBy: (req as any).userId,
    }).returning();
    // Insert items
    for (const item of items) {
      await db.insert(kotItemsTable).values({
        kotId: kot.id,
        menuItemId: item.menuItemId,
        menuItemName: item.menuItemName || "",
        quantity: item.quantity || 1,
        modifiers: item.modifiers || null,
        notes: item.notes || null,
        status: "new",
      });
    }
    const kotItems = await db.select().from(kotItemsTable).where(eq(kotItemsTable.kotId, kot.id));
    res.status(201).json({ ...kot, items: kotItems });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Update KOT status ────────────────────────────────────────────────────────

router.patch("/kot-orders/:id", authMiddleware, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const { status, expedite, notes } = req.body;
    const update: any = {};
    if (status) update.status = status;
    if (expedite !== undefined) update.expedite = expedite;
    if (notes !== undefined) update.notes = notes;
    const [updated] = await db.update(kotOrdersTable).set(update).where(eq(kotOrdersTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "KOT not found" }); return; }
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Update KOT Item status ───────────────────────────────────────────────────

router.patch("/kot-items/:id", authMiddleware, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const { status, notes } = req.body;
    const update: any = {};
    if (status) update.status = status;
    if (notes !== undefined) update.notes = notes;
    const [updated] = await db.update(kotItemsTable).set(update).where(eq(kotItemsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "KOT item not found" }); return; }
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Cancel KOT Item (requires manager) ──────────────────────────────────────

router.post("/kot-items/:id/cancel", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [updated] = await db.update(kotItemsTable).set({ status: "cancelled" }).where(eq(kotItemsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "KOT item not found" }); return; }
    await createAuditLog("kot_items", id, "cancel", null, { status: "cancelled" }, String((req as any).userId));
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
