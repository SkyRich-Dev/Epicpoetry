import { Router, type IRouter } from "express";
import { eq, and, gte, lte } from "drizzle-orm";
import { db, wasteEntriesTable, ingredientsTable, menuItemsTable, categoriesTable, recipeLinesTable } from "@workspace/db";
import { ListWasteEntriesResponse, CreateWasteEntryBody, UpdateWasteEntryParams, UpdateWasteEntryBody, GetWasteSummaryResponse } from "@workspace/api-zod";
import { authMiddleware } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { generateCode } from "../lib/codeGenerator";

const router: IRouter = Router();

router.get("/waste", async (req, res): Promise<void> => {
  const conditions = [];
  if (req.query.fromDate) conditions.push(gte(wasteEntriesTable.wasteDate, req.query.fromDate as string));
  if (req.query.toDate) conditions.push(lte(wasteEntriesTable.wasteDate, req.query.toDate as string));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const query = db
    .select({
      id: wasteEntriesTable.id,
      wasteNumber: wasteEntriesTable.wasteNumber,
      wasteDate: wasteEntriesTable.wasteDate,
      wasteType: wasteEntriesTable.wasteType,
      ingredientId: wasteEntriesTable.ingredientId,
      ingredientName: ingredientsTable.name,
      menuItemId: wasteEntriesTable.menuItemId,
      categoryId: wasteEntriesTable.categoryId,
      categoryName: categoriesTable.name,
      reason: wasteEntriesTable.reason,
      quantity: wasteEntriesTable.quantity,
      uom: wasteEntriesTable.uom,
      costValue: wasteEntriesTable.costValue,
      department: wasteEntriesTable.department,
      notes: wasteEntriesTable.notes,
      approvalStatus: wasteEntriesTable.approvalStatus,
      createdAt: wasteEntriesTable.createdAt,
    })
    .from(wasteEntriesTable)
    .leftJoin(ingredientsTable, eq(wasteEntriesTable.ingredientId, ingredientsTable.id))
    .leftJoin(categoriesTable, eq(wasteEntriesTable.categoryId, categoriesTable.id));

  const entries = whereClause
    ? await query.where(whereClause).orderBy(wasteEntriesTable.createdAt)
    : await query.orderBy(wasteEntriesTable.createdAt);

  const result = entries.map(e => {
    return { ...e, menuItemName: null };
  });

  res.json(ListWasteEntriesResponse.parse(result));
});

router.post("/waste", authMiddleware, async (req, res): Promise<void> => {
  const parsed = CreateWasteEntryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const wasteNumber = await generateCode("WST", "waste_entries");
  let costValue = 0;

  if (parsed.data.wasteType === "ingredient" && parsed.data.ingredientId) {
    const [ing] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, parsed.data.ingredientId));
    if (ing) {
      costValue = ing.weightedAvgCost * parsed.data.quantity;
      await db.update(ingredientsTable).set({
        currentStock: Math.max(0, ing.currentStock - parsed.data.quantity),
      }).where(eq(ingredientsTable.id, parsed.data.ingredientId));
    }
  } else if (parsed.data.wasteType === "menu_item" && parsed.data.menuItemId) {
    const lines = await db.select().from(recipeLinesTable).where(eq(recipeLinesTable.menuItemId, parsed.data.menuItemId));
    for (const line of lines) {
      const [ing] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, line.ingredientId));
      if (ing) {
        const netQty = line.quantity * (1 + (line.wastagePercent || 0) / 100);
        const costPerRecipeUnit = ing.weightedAvgCost / (ing.conversionFactor || 1);
        costValue += costPerRecipeUnit * netQty * parsed.data.quantity;
      }
    }
  }

  const [entry] = await db.insert(wasteEntriesTable).values({
    wasteNumber,
    wasteDate: parsed.data.wasteDate,
    wasteType: parsed.data.wasteType,
    ingredientId: parsed.data.ingredientId,
    menuItemId: parsed.data.menuItemId,
    categoryId: parsed.data.categoryId,
    reason: parsed.data.reason,
    quantity: parsed.data.quantity,
    uom: parsed.data.uom,
    costValue,
    department: parsed.data.department,
    notes: parsed.data.notes,
  }).returning();

  await createAuditLog("waste", entry.id, "create", null, entry);
  res.status(201).json({
    ...entry,
    ingredientName: null,
    menuItemName: null,
    categoryName: null,
  });
});

router.patch("/waste/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = UpdateWasteEntryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateWasteEntryBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [entry] = await db.update(wasteEntriesTable).set(parsed.data).where(eq(wasteEntriesTable.id, params.data.id)).returning();
  if (!entry) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...entry, ingredientName: null, menuItemName: null, categoryName: null });
});

router.delete("/waste/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = UpdateWasteEntryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [entry] = await db.delete(wasteEntriesTable).where(eq(wasteEntriesTable.id, params.data.id)).returning();
  if (!entry) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ success: true });
});

router.get("/waste/summary", async (_req, res): Promise<void> => {
  const entries = await db
    .select({
      id: wasteEntriesTable.id,
      wasteDate: wasteEntriesTable.wasteDate,
      costValue: wasteEntriesTable.costValue,
      reason: wasteEntriesTable.reason,
      categoryId: wasteEntriesTable.categoryId,
      categoryName: categoriesTable.name,
    })
    .from(wasteEntriesTable)
    .leftJoin(categoriesTable, eq(wasteEntriesTable.categoryId, categoriesTable.id));

  const totalWasteValue = entries.reduce((sum, e) => sum + e.costValue, 0);

  const byCategory = new Map<string, { name: string; value: number; count: number }>();
  const byReason = new Map<string, { name: string; value: number; count: number }>();
  const byDate = new Map<string, number>();

  for (const e of entries) {
    const catName = e.categoryName ?? "Uncategorized";
    const cat = byCategory.get(catName) || { name: catName, value: 0, count: 0 };
    cat.value += e.costValue;
    cat.count++;
    byCategory.set(catName, cat);

    const reason = e.reason ?? "Unknown";
    const r = byReason.get(reason) || { name: reason, value: 0, count: 0 };
    r.value += e.costValue;
    r.count++;
    byReason.set(reason, r);

    byDate.set(e.wasteDate, (byDate.get(e.wasteDate) || 0) + e.costValue);
  }

  res.json(GetWasteSummaryResponse.parse({
    totalWasteValue,
    totalWasteEntries: entries.length,
    wasteByCategory: Array.from(byCategory.values()),
    wasteByReason: Array.from(byReason.values()),
    wasteTrend: Array.from(byDate.entries()).map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date)),
  }));
});

export default router;
