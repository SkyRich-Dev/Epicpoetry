import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, purchaseOrdersTable, purchaseOrderLinesTable, grnRecordsTable, vendorsTable, ingredientsTable } from "@workspace/db";
import { authMiddleware, adminOnly, managerOrAdmin } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { generateCode } from "../lib/codeGenerator";
import { notifyPoPendingApproval } from "../lib/alertTriggers";

const router: IRouter = Router();

function round2(n: number) { return Math.round((n || 0) * 100) / 100; }

// ─── List POs ─────────────────────────────────────────────────────────────────

router.get("/purchase-orders", authMiddleware, async (req, res): Promise<void> => {
  try {
    const pos = await db.select({
      id: purchaseOrdersTable.id,
      poNumber: purchaseOrdersTable.poNumber,
      vendorId: purchaseOrdersTable.vendorId,
      vendorName: vendorsTable.name,
      status: purchaseOrdersTable.status,
      requiredBy: purchaseOrdersTable.requiredBy,
      totalAmount: purchaseOrdersTable.totalAmount,
      notes: purchaseOrdersTable.notes,
      createdBy: purchaseOrdersTable.createdBy,
      approvedBy: purchaseOrdersTable.approvedBy,
      approvedAt: purchaseOrdersTable.approvedAt,
      createdAt: purchaseOrdersTable.createdAt,
    }).from(purchaseOrdersTable)
      .leftJoin(vendorsTable, eq(purchaseOrdersTable.vendorId, vendorsTable.id))
      .orderBy(desc(purchaseOrdersTable.createdAt));
    res.json(pos);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/purchase-orders/:id", authMiddleware, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, id));
    if (!po) { res.status(404).json({ error: "PO not found" }); return; }
    const lines = await db.select({
      id: purchaseOrderLinesTable.id,
      ingredientId: purchaseOrderLinesTable.ingredientId,
      ingredientName: ingredientsTable.name,
      ingredientCode: ingredientsTable.code,
      qtyOrdered: purchaseOrderLinesTable.qtyOrdered,
      qtyReceived: purchaseOrderLinesTable.qtyReceived,
      unitPrice: purchaseOrderLinesTable.unitPrice,
      uom: purchaseOrderLinesTable.uom,
    }).from(purchaseOrderLinesTable)
      .leftJoin(ingredientsTable, eq(purchaseOrderLinesTable.ingredientId, ingredientsTable.id))
      .where(eq(purchaseOrderLinesTable.poId, id));
    const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, po.vendorId));
    res.json({ ...po, vendor, lines });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Create PO ────────────────────────────────────────────────────────────────

router.post("/purchase-orders", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
  try {
    const { vendorId, requiredBy, notes, lines } = req.body;
    if (!vendorId) { res.status(400).json({ error: "Vendor is required" }); return; }
    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ error: "At least one line item is required" }); return;
    }
    const poNumber = await generateCode("PO", "purchase_orders", db);
    let totalAmount = 0;
    for (const l of lines) {
      totalAmount = round2(totalAmount + (l.qtyOrdered || 0) * (l.unitPrice || 0));
    }
    const [po] = await db.insert(purchaseOrdersTable).values({
      poNumber, vendorId, requiredBy, notes, totalAmount,
      status: "draft", createdBy: (req as any).userId,
    }).returning();
    for (const l of lines) {
      await db.insert(purchaseOrderLinesTable).values({
        poId: po.id,
        ingredientId: l.ingredientId,
        qtyOrdered: l.qtyOrdered || 0,
        unitPrice: l.unitPrice || 0,
        uom: l.uom || "unit",
      });
    }
    await createAuditLog("purchase_orders", po.id, "create", null, po, String((req as any).userId));
    res.status(201).json(po);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── PO Status transitions ────────────────────────────────────────────────────

router.post("/purchase-orders/:id/submit", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [po] = await db.update(purchaseOrdersTable)
      .set({ status: "submitted" })
      .where(and(eq(purchaseOrdersTable.id, id), eq(purchaseOrdersTable.status, "draft")))
      .returning();
    if (!po) { res.status(400).json({ error: "PO not found or not in draft status" }); return; }
    // Fire in-app notification for admin
    const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, po.vendorId));
    await notifyPoPendingApproval(po.poNumber, vendor?.name || "Unknown Vendor");
    res.json(po);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/purchase-orders/:id/approve", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [po] = await db.update(purchaseOrdersTable)
      .set({ status: "approved", approvedBy: (req as any).userId, approvedAt: new Date() })
      .where(and(eq(purchaseOrdersTable.id, id), eq(purchaseOrdersTable.status, "submitted")))
      .returning();
    if (!po) { res.status(400).json({ error: "PO not found or not in submitted status" }); return; }
    await createAuditLog("purchase_orders", id, "approve", { status: "submitted" }, { status: "approved" }, String((req as any).userId));
    res.json(po);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/purchase-orders/:id/cancel", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [po] = await db.update(purchaseOrdersTable)
      .set({ status: "cancelled" })
      .where(eq(purchaseOrdersTable.id, id))
      .returning();
    if (!po) { res.status(404).json({ error: "PO not found" }); return; }
    res.json(po);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Update PO ────────────────────────────────────────────────────────────────

router.post("/purchase-orders/:id/send", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [po] = await db.update(purchaseOrdersTable)
      .set({ status: "sent_to_vendor" })
      .where(and(eq(purchaseOrdersTable.id, id), eq(purchaseOrdersTable.status, "approved")))
      .returning();
    if (!po) { res.status(400).json({ error: "PO not found or not in approved status" }); return; }
    await createAuditLog("purchase_orders", id, "send", { status: "approved" }, { status: "sent_to_vendor" }, String((req as any).userId));
    res.json(po);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.patch("/purchase-orders/:id", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const { vendorId, requiredBy, notes, lines } = req.body;
    // Can only edit draft POs
    const [existing] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, id));
    if (!existing || existing.status !== "draft") {
      res.status(400).json({ error: "Can only edit draft POs" }); return;
    }
    const update: any = {};
    if (vendorId !== undefined) update.vendorId = vendorId;
    if (requiredBy !== undefined) update.requiredBy = requiredBy;
    if (notes !== undefined) update.notes = notes;
    if (lines && Array.isArray(lines)) {
      let totalAmount = 0;
      for (const l of lines) totalAmount = round2(totalAmount + (l.qtyOrdered || 0) * (l.unitPrice || 0));
      update.totalAmount = totalAmount;
      await db.delete(purchaseOrderLinesTable).where(eq(purchaseOrderLinesTable.poId, id));
      for (const l of lines) {
        await db.insert(purchaseOrderLinesTable).values({ poId: id, ingredientId: l.ingredientId, qtyOrdered: l.qtyOrdered || 0, unitPrice: l.unitPrice || 0, uom: l.uom || "unit" });
      }
    }
    const [updated] = await db.update(purchaseOrdersTable).set(update).where(eq(purchaseOrdersTable.id, id)).returning();
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
