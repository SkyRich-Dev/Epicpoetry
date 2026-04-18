import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, ingredientsTable, stockSnapshotsTable, stockAdjustmentsTable, purchaseLinesTable, purchasesTable, wasteEntriesTable } from "@workspace/db";
import { SaveStockSnapshotBody, CreateStockAdjustmentBody, ListStockSnapshotsQueryParams } from "@workspace/api-zod";
import { authMiddleware, adminOnly, managerOrAdmin } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { validateNotFutureDate } from "../lib/dateValidation";

const router: IRouter = Router();

router.get("/inventory/low-stock", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
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
  const ingredients = await db.select().from(ingredientsTable).where(eq(ingredientsTable.active, true));
  const overview = ingredients.map(ing => ({
    ingredientId: ing.id,
    ingredientName: ing.name,
    currentStock: ing.currentStock,
    stockUom: ing.stockUom,
    reorderLevel: ing.reorderLevel,
    stockValue: ing.currentStock * ing.weightedAvgCost,
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

router.post("/inventory/stock-snapshots", authMiddleware, adminOnly, async (req, res): Promise<void> => {
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

router.post("/inventory/adjustments", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const parsed = CreateStockAdjustmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [ing] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, parsed.data.ingredientId));
  if (!ing) { res.status(404).json({ error: "Ingredient not found" }); return; }

  const qtyChange = parsed.data.adjustmentType === "increase" ? parsed.data.quantity : -parsed.data.quantity;
  const newStock = ing.currentStock + qtyChange;
  if (newStock < 0) { res.status(400).json({ error: `Adjustment would result in negative stock (${newStock}). Current stock: ${ing.currentStock}` }); return; }
  await db.update(ingredientsTable).set({ currentStock: newStock }).where(eq(ingredientsTable.id, parsed.data.ingredientId));

  const [adj] = await db.insert(stockAdjustmentsTable).values(parsed.data).returning();
  await createAuditLog("inventory", adj.id, "adjustment", null, adj);
  res.status(201).json(adj);
});

export default router;
