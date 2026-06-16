import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, stocktakesTable, stocktakeLinesTable, ingredientsTable } from "@workspace/db";
import { authMiddleware, adminOnly, managerOrAdmin } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { generateCode } from "../lib/codeGenerator";

const router: IRouter = Router();

function round2(n: number) { return Math.round((n || 0) * 100) / 100; }

// ─── List stocktakes ──────────────────────────────────────────────────────────

router.get("/stocktakes", authMiddleware, async (req, res): Promise<void> => {
  try {
    const stocktakes = await db.select().from(stocktakesTable).orderBy(desc(stocktakesTable.createdAt));
    res.json(stocktakes);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/stocktakes/:id", authMiddleware, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [stocktake] = await db.select().from(stocktakesTable).where(eq(stocktakesTable.id, id));
    if (!stocktake) { res.status(404).json({ error: "Stocktake not found" }); return; }
    const lines = await db.select({
      id: stocktakeLinesTable.id,
      ingredientId: stocktakeLinesTable.ingredientId,
      ingredientName: ingredientsTable.name,
      ingredientCode: ingredientsTable.code,
      uom: stocktakeLinesTable.uom,
      expectedQty: stocktakeLinesTable.expectedQty,
      actualQty: stocktakeLinesTable.actualQty,
      variance: stocktakeLinesTable.variance,
      varianceCost: stocktakeLinesTable.varianceCost,
      counted: stocktakeLinesTable.counted,
    }).from(stocktakeLinesTable)
      .leftJoin(ingredientsTable, eq(stocktakeLinesTable.ingredientId, ingredientsTable.id))
      .where(eq(stocktakeLinesTable.stocktakeId, id));
    res.json({ ...stocktake, lines });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Initiate Stocktake ───────────────────────────────────────────────────────

router.post("/stocktakes", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
  try {
    const { scope = "full", scopeDetail, notes } = req.body;
    const stocktakeNumber = await generateCode("ST", "stocktakes", db);
    const [stocktake] = await db.insert(stocktakesTable).values({
      stocktakeNumber, scope, scopeDetail, notes,
      status: "in_progress",
      initiatedBy: (req as any).userId,
    }).returning();

    // Snapshot current stock for all active ingredients
    const ingredients = await db.select().from(ingredientsTable).where(eq(ingredientsTable.active, true));
    for (const ing of ingredients) {
      await db.insert(stocktakeLinesTable).values({
        stocktakeId: stocktake.id,
        ingredientId: ing.id,
        expectedQty: ing.currentStock || 0,
        uom: ing.stockUom || "unit",
        counted: false,
      });
    }
    res.status(201).json({ ...stocktake, linesCreated: ingredients.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Update stocktake line (enter actual count) ───────────────────────────────

router.patch("/stocktake-lines/:id", authMiddleware, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const { actualQty } = req.body;
    if (actualQty === undefined || actualQty === null) {
      res.status(400).json({ error: "actualQty is required" }); return;
    }
    const [line] = await db.select({
      id: stocktakeLinesTable.id,
      ingredientId: stocktakeLinesTable.ingredientId,
      expectedQty: stocktakeLinesTable.expectedQty,
      stocktakeId: stocktakeLinesTable.stocktakeId,
    }).from(stocktakeLinesTable).where(eq(stocktakeLinesTable.id, id));
    if (!line) { res.status(404).json({ error: "Line not found" }); return; }
    const [ing] = await db.select({ weightedAvgCost: ingredientsTable.weightedAvgCost })
      .from(ingredientsTable).where(eq(ingredientsTable.id, line.ingredientId));
    const variance = round2(actualQty - line.expectedQty);
    const varianceCost = round2(Math.abs(variance) * (ing?.weightedAvgCost || 0));
    const [updated] = await db.update(stocktakeLinesTable)
      .set({ actualQty, variance, varianceCost, counted: true })
      .where(eq(stocktakeLinesTable.id, id))
      .returning();
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Submit for approval ───────────────────────────────────────────────────────

router.post("/stocktakes/:id/submit", authMiddleware, managerOrAdmin, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    // Calculate total variance cost
    const lines = await db.select({ varianceCost: stocktakeLinesTable.varianceCost })
      .from(stocktakeLinesTable).where(eq(stocktakeLinesTable.stocktakeId, id));
    const totalVarianceCost = round2(lines.reduce((sum, l) => sum + (l.varianceCost || 0), 0));
    const [updated] = await db.update(stocktakesTable)
      .set({ status: "pending_approval", totalVarianceCost })
      .where(eq(stocktakesTable.id, id))
      .returning();
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Admin approve — updates system stock ────────────────────────────────────

router.post("/stocktakes/:id/approve", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const { notes } = req.body;
    const lines = await db.select().from(stocktakeLinesTable).where(eq(stocktakeLinesTable.stocktakeId, id));
    // Apply actual counts to stock
    for (const line of lines) {
      if (line.counted && line.actualQty !== null && line.actualQty !== undefined) {
        await db.update(ingredientsTable)
          .set({ currentStock: line.actualQty })
          .where(eq(ingredientsTable.id, line.ingredientId));
      }
    }
    const totalVarianceCost = round2(lines.reduce((sum, l) => sum + (l.varianceCost || 0), 0));
    const [stocktake] = await db.update(stocktakesTable)
      .set({ status: "approved", approvedBy: (req as any).userId, approvedAt: new Date(), totalVarianceCost, notes })
      .where(eq(stocktakesTable.id, id))
      .returning();
    if (!stocktake) { res.status(404).json({ error: "Stocktake not found" }); return; }
    await createAuditLog("stocktakes", id, "approve", { status: "pending_approval" }, { status: "approved" }, String((req as any).userId));
    res.json(stocktake);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
