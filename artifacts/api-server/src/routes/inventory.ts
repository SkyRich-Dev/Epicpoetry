import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, ingredientsTable, stockSnapshotsTable, stockAdjustmentsTable, purchaseLinesTable, purchasesTable, wasteEntriesTable, categoriesTable } from "@workspace/db";
import { SaveStockSnapshotBody, CreateStockAdjustmentBody, ListStockSnapshotsQueryParams } from "@workspace/api-zod";
import { authMiddleware, requirePermission } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { validateNotFutureDate } from "../lib/dateValidation";
import { z } from "zod/v4";

const router: IRouter = Router();

const TransferStockBody = z.object({
  ingredientId: z.number(),
  quantity: z.number().positive(),
  reason: z.string().trim().optional(),
});

function normalizeInventoryLocation(value?: string | null): "inhouse" | "godown" {
  return String(value || "").trim().toLowerCase() === "godown" ? "godown" : "inhouse";
}

router.get("/inventory/low-stock", authMiddleware, requirePermission("inventory.view"), async (req, res): Promise<void> => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const ingredients = await db.select().from(ingredientsTable).where(eq(ingredientsTable.active, true));
  const low = ingredients
    .filter(i => i.currentStock <= i.reorderLevel)
    .map(i => ({
      ingredientId: i.id,
      ingredientName: i.name,
      name: i.name,
      currentStock: Math.round(i.currentStock * 1000) / 1000,
      minStock: i.reorderLevel,
      reorderLevel: i.reorderLevel,
      uom: i.stockUom,
      stockUom: i.stockUom,
      shortage: Math.round((i.reorderLevel - i.currentStock) * 1000) / 1000,
    }))
    .sort((a, b) => b.shortage - a.shortage)
    .slice(0, limit);
  res.json(low);
});

router.get("/inventory/stock-overview", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: ingredientsTable.id,
      name: ingredientsTable.name,
      categoryId: ingredientsTable.categoryId,
      categoryName: categoriesTable.name,
      currentStock: ingredientsTable.currentStock,
      godownStock: ingredientsTable.godownStock,
      stockUom: ingredientsTable.stockUom,
      reorderLevel: ingredientsTable.reorderLevel,
      weightedAvgCost: ingredientsTable.weightedAvgCost,
    })
    .from(ingredientsTable)
    .leftJoin(categoriesTable, eq(ingredientsTable.categoryId, categoriesTable.id))
    .where(eq(ingredientsTable.active, true));
  const overview = rows.map(ing => ({
    ingredientId: ing.id,
    ingredientName: ing.name,
    categoryId: ing.categoryId ?? null,
    categoryName: ing.categoryName ?? null,
    currentStock: ing.currentStock,
    godownStock: ing.godownStock,
    totalStock: ing.currentStock + ing.godownStock,
    stockUom: ing.stockUom,
    reorderLevel: ing.reorderLevel,
    stockValue: ing.currentStock * ing.weightedAvgCost,
    godownStockValue: ing.godownStock * ing.weightedAvgCost,
    totalStockValue: (ing.currentStock + ing.godownStock) * ing.weightedAvgCost,
    lowStock: ing.currentStock <= ing.reorderLevel,
    lastPurchaseDate: null,
  }));
  res.json(overview);
});

router.get("/inventory/stock-snapshots", async (req, res): Promise<void> => {
  const query = ListStockSnapshotsQueryParams.safeParse(req.query);
  let snapshots;
  if (query.success && query.data.date) {
    snapshots = await db
      .select({
        id: stockSnapshotsTable.id,
        snapshotDate: stockSnapshotsTable.snapshotDate,
        ingredientId: stockSnapshotsTable.ingredientId,
        ingredientName: ingredientsTable.name,
        openingQty: stockSnapshotsTable.openingQty,
        inwardQty: stockSnapshotsTable.inwardQty,
        consumedQty: stockSnapshotsTable.consumedQty,
        wasteQty: stockSnapshotsTable.wasteQty,
        trialQty: stockSnapshotsTable.trialQty,
        closingQty: stockSnapshotsTable.closingQty,
        stockValue: stockSnapshotsTable.stockValue,
      })
      .from(stockSnapshotsTable)
      .leftJoin(ingredientsTable, eq(stockSnapshotsTable.ingredientId, ingredientsTable.id))
      .where(eq(stockSnapshotsTable.snapshotDate, query.data.date));
  } else {
    snapshots = await db
      .select({
        id: stockSnapshotsTable.id,
        snapshotDate: stockSnapshotsTable.snapshotDate,
        ingredientId: stockSnapshotsTable.ingredientId,
        ingredientName: ingredientsTable.name,
        openingQty: stockSnapshotsTable.openingQty,
        inwardQty: stockSnapshotsTable.inwardQty,
        consumedQty: stockSnapshotsTable.consumedQty,
        wasteQty: stockSnapshotsTable.wasteQty,
        trialQty: stockSnapshotsTable.trialQty,
        closingQty: stockSnapshotsTable.closingQty,
        stockValue: stockSnapshotsTable.stockValue,
      })
      .from(stockSnapshotsTable)
      .leftJoin(ingredientsTable, eq(stockSnapshotsTable.ingredientId, ingredientsTable.id));
  }
  res.json(snapshots);
});

router.post("/inventory/stock-snapshots", authMiddleware, requirePermission("inventory.edit"), async (req, res): Promise<void> => {
  const parsed = SaveStockSnapshotBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const dateErr = validateNotFutureDate(parsed.data.snapshotDate, "Snapshot date");
  if (dateErr) { res.status(400).json({ error: dateErr }); return; }

  await db.delete(stockSnapshotsTable).where(eq(stockSnapshotsTable.snapshotDate, parsed.data.snapshotDate));

  const results = [];
  for (const item of parsed.data.items) {
    const [ing] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, item.ingredientId));
    if (!ing) continue;

    const openingQty = ing.currentStock;
    const [snapshot] = await db.insert(stockSnapshotsTable).values({
      snapshotDate: parsed.data.snapshotDate,
      ingredientId: item.ingredientId,
      openingQty,
      inwardQty: 0,
      consumedQty: Math.max(0, openingQty - item.closingQty),
      wasteQty: 0,
      trialQty: 0,
      closingQty: item.closingQty,
      stockValue: item.closingQty * ing.weightedAvgCost,
    }).returning();

    await db.update(ingredientsTable).set({ currentStock: item.closingQty }).where(eq(ingredientsTable.id, item.ingredientId));

    results.push({ ...snapshot, ingredientName: ing.name });
  }

  res.json(results);
});

router.post("/inventory/adjustments", authMiddleware, requirePermission("inventory.edit"), async (req, res): Promise<void> => {
  const parsed = CreateStockAdjustmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [ing] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, parsed.data.ingredientId));
  if (!ing) { res.status(404).json({ error: "Ingredient not found" }); return; }

  const inventoryLocation = normalizeInventoryLocation((req.body as any)?.inventoryLocation);
  const qtyChange = parsed.data.adjustmentType === "increase" ? parsed.data.quantity : -parsed.data.quantity;
  const currentStock = inventoryLocation === "godown" ? ing.godownStock : ing.currentStock;
  const newStock = currentStock + qtyChange;
  if (newStock < 0) { res.status(400).json({ error: `Adjustment would result in negative ${inventoryLocation} stock (${newStock}). Current stock: ${currentStock}` }); return; }
  await db.update(ingredientsTable).set(
    inventoryLocation === "godown" ? { godownStock: newStock } : { currentStock: newStock },
  ).where(eq(ingredientsTable.id, parsed.data.ingredientId));

  const [adj] = await db.insert(stockAdjustmentsTable).values({
    ...parsed.data,
    reason: inventoryLocation === "godown" ? `[Godown] ${parsed.data.reason}` : parsed.data.reason,
  }).returning();
  await createAuditLog("inventory", adj.id, "adjustment", null, { ...adj, inventoryLocation });
  res.status(201).json(adj);
});

router.post("/inventory/transfer", authMiddleware, requirePermission("inventory.edit"), async (req, res): Promise<void> => {
  const parsed = TransferStockBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  try {
    const [updated] = await db.transaction(async (tx) => {
      const [ing] = await tx.select().from(ingredientsTable).where(eq(ingredientsTable.id, parsed.data.ingredientId)).limit(1);
      if (!ing) throw Object.assign(new Error("Ingredient not found"), { httpStatus: 404 });
      if (ing.godownStock + 0.000001 < parsed.data.quantity) {
        throw Object.assign(new Error(`Insufficient godown stock. Available: ${ing.godownStock} ${ing.stockUom}`), { httpStatus: 400 });
      }
      const updatedRows = await tx.update(ingredientsTable).set({
        godownStock: ing.godownStock - parsed.data.quantity,
        currentStock: ing.currentStock + parsed.data.quantity,
      }).where(eq(ingredientsTable.id, ing.id)).returning();
      await tx.insert(stockAdjustmentsTable).values({
        ingredientId: parsed.data.ingredientId,
        adjustmentType: "transfer",
        quantity: parsed.data.quantity,
        reason: parsed.data.reason ? `Godown to in-house: ${parsed.data.reason}` : "Godown to in-house transfer",
        createdBy: (req as any).userId,
      });
      return updatedRows;
    });

    await createAuditLog("inventory", updated.id, "transfer", null, {
      ingredientId: parsed.data.ingredientId,
      quantity: parsed.data.quantity,
      from: "godown",
      to: "inhouse",
      reason: parsed.data.reason || null,
    });
    res.json({
      ingredientId: updated.id,
      ingredientName: updated.name,
      currentStock: updated.currentStock,
      godownStock: updated.godownStock,
      totalStock: updated.currentStock + updated.godownStock,
      stockUom: updated.stockUom,
    });
  } catch (error: any) {
    res.status(error?.httpStatus || 500).json({ error: error?.message || "Failed to transfer stock" });
  }
});

export default router;
