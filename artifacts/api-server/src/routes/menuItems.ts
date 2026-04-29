import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, menuItemsTable, recipeLinesTable, categoriesTable, ingredientsTable, systemConfigTable, salesInvoiceLinesTable } from "@workspace/db";
import { ListMenuItemsResponse, CreateMenuItemBody, GetMenuItemParams, UpdateMenuItemParams, UpdateMenuItemBody, GetRecipeParams, SaveRecipeParams, SaveRecipeBody, GetMenuItemCostingParams } from "@workspace/api-zod";
import { authMiddleware, adminOnly } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { generateCode } from "../lib/codeGenerator";
import { findNameDuplicates, shouldBlockNameDuplicates, buildDupeErrorPayload, type NameRecord } from "../lib/nameDedupe";

const router: IRouter = Router();

async function loadMenuItemPool(): Promise<NameRecord[]> {
  const rows = await db
    .select({ id: menuItemsTable.id, code: menuItemsTable.code, name: menuItemsTable.name, categoryId: menuItemsTable.categoryId, categoryName: categoriesTable.name })
    .from(menuItemsTable)
    .leftJoin(categoriesTable, eq(menuItemsTable.categoryId, categoriesTable.id));
  return rows.map(r => ({ id: r.id, name: r.name, code: r.code, groupKey: r.categoryId, groupName: r.categoryName }));
}

async function getIngredientCostAndConversion(ingredientId: number): Promise<{ costPerStockUnit: number; conversionFactor: number }> {
  const configs = await db.select().from(systemConfigTable);
  const config = configs[0];
  const [ing] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, ingredientId));
  if (!ing) return { costPerStockUnit: 0, conversionFactor: 1 };
  const method = config?.costingMethod || "weighted_average";
  let costPerStockUnit = ing.weightedAvgCost;
  if (method === "latest") costPerStockUnit = ing.latestCost;
  else if (method === "standard") costPerStockUnit = ing.currentCost;
  return { costPerStockUnit, conversionFactor: ing.conversionFactor || 1 };
}

function computeLineCost(costPerStockUnit: number, conversionFactor: number, recipeQty: number, wastagePercent: number): { netQty: number; costPerRecipeUnit: number; lineCost: number } {
  const costPerRecipeUnit = costPerStockUnit / conversionFactor;
  const netQty = recipeQty * (1 + (wastagePercent || 0) / 100);
  const lineCost = costPerRecipeUnit * netQty;
  return { netQty, costPerRecipeUnit, lineCost };
}

async function calculateItemCost(menuItemId: number): Promise<{ ingredientCost: number; packagingCost: number; total: number }> {
  const lines = await db.select().from(recipeLinesTable).where(eq(recipeLinesTable.menuItemId, menuItemId));
  let ingredientCost = 0;
  let packagingCost = 0;
  for (const line of lines) {
    const { costPerStockUnit, conversionFactor } = await getIngredientCostAndConversion(line.ingredientId);
    const { lineCost } = computeLineCost(costPerStockUnit, conversionFactor, line.quantity, line.wastagePercent || 0);
    ingredientCost += lineCost;
  }
  return { ingredientCost, packagingCost, total: ingredientCost + packagingCost };
}

router.get("/menu-items", async (_req, res): Promise<void> => {
  const items = await db
    .select({
      id: menuItemsTable.id,
      code: menuItemsTable.code,
      name: menuItemsTable.name,
      categoryId: menuItemsTable.categoryId,
      categoryName: categoriesTable.name,
      description: menuItemsTable.description,
      sellingPrice: menuItemsTable.sellingPrice,
      dineInPrice: menuItemsTable.dineInPrice,
      takeawayPrice: menuItemsTable.takeawayPrice,
      deliveryPrice: menuItemsTable.deliveryPrice,
      onlinePrice: menuItemsTable.onlinePrice,
      active: menuItemsTable.active,
      verified: menuItemsTable.verified,
      verifiedBy: menuItemsTable.verifiedBy,
      verifiedAt: menuItemsTable.verifiedAt,
      createdAt: menuItemsTable.createdAt,
    })
    .from(menuItemsTable)
    .leftJoin(categoriesTable, eq(menuItemsTable.categoryId, categoriesTable.id));

  const result = [];
  for (const item of items) {
    const costing = await calculateItemCost(item.id);
    const margin = item.sellingPrice - costing.total;
    const marginPercent = item.sellingPrice > 0 ? (margin / item.sellingPrice) * 100 : 0;
    result.push({
      ...item,
      productionCost: costing.total,
      margin,
      marginPercent,
    });
  }

  res.json(result);
});

router.post("/menu-items", authMiddleware, async (req, res): Promise<void> => {
  const parsed = CreateMenuItemBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const confirmDuplicate = req.body?.confirmDuplicate === true;
  const confirmSimilar = req.body?.confirmSimilar === true;
  const pool = await loadMenuItemPool();
  const matches = findNameDuplicates(parsed.data.name, parsed.data.categoryId ?? null, pool);
  const block = shouldBlockNameDuplicates(matches, confirmDuplicate, confirmSimilar);
  if (block) { res.status(409).json(buildDupeErrorPayload(block.reason, matches, { entity: "menu item", groupLabel: "category" })); return; }
  const code = await generateCode("MNU", "menu_items");
  const [item] = await db.insert(menuItemsTable).values({ ...parsed.data, code }).returning();
  await createAuditLog("menu_items", item.id, "create", null, item);
  res.status(201).json({
    ...item,
    categoryName: null,
    productionCost: 0,
    margin: item.sellingPrice,
    marginPercent: 100,
  });
});

router.get("/menu-items/:id", async (req, res): Promise<void> => {
  const params = GetMenuItemParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [item] = await db
    .select({
      id: menuItemsTable.id,
      code: menuItemsTable.code,
      name: menuItemsTable.name,
      categoryId: menuItemsTable.categoryId,
      categoryName: categoriesTable.name,
      description: menuItemsTable.description,
      sellingPrice: menuItemsTable.sellingPrice,
      dineInPrice: menuItemsTable.dineInPrice,
      takeawayPrice: menuItemsTable.takeawayPrice,
      deliveryPrice: menuItemsTable.deliveryPrice,
      onlinePrice: menuItemsTable.onlinePrice,
      active: menuItemsTable.active,
      createdAt: menuItemsTable.createdAt,
    })
    .from(menuItemsTable)
    .leftJoin(categoriesTable, eq(menuItemsTable.categoryId, categoriesTable.id))
    .where(eq(menuItemsTable.id, params.data.id));

  if (!item) { res.status(404).json({ error: "Not found" }); return; }

  const costing = await calculateItemCost(item.id);
  const margin = item.sellingPrice - costing.total;
  const marginPercent = item.sellingPrice > 0 ? (margin / item.sellingPrice) * 100 : 0;

  const recipeLines = await db
    .select({
      id: recipeLinesTable.id,
      menuItemId: recipeLinesTable.menuItemId,
      ingredientId: recipeLinesTable.ingredientId,
      ingredientName: ingredientsTable.name,
      quantity: recipeLinesTable.quantity,
      uom: recipeLinesTable.uom,
      wastagePercent: recipeLinesTable.wastagePercent,
      mandatory: recipeLinesTable.mandatory,
      stage: recipeLinesTable.stage,
      notes: recipeLinesTable.notes,
    })
    .from(recipeLinesTable)
    .leftJoin(ingredientsTable, eq(recipeLinesTable.ingredientId, ingredientsTable.id))
    .where(eq(recipeLinesTable.menuItemId, params.data.id));

  const enrichedLines = [];
  for (const line of recipeLines) {
    const { costPerStockUnit, conversionFactor } = await getIngredientCostAndConversion(line.ingredientId);
    const { netQty, costPerRecipeUnit, lineCost } = computeLineCost(costPerStockUnit, conversionFactor, line.quantity, line.wastagePercent || 0);
    enrichedLines.push({
      ...line,
      netQuantity: netQty,
      costPerUnit: costPerRecipeUnit,
      lineCost,
    });
  }

  res.json({
    item: { ...item, productionCost: costing.total, margin, marginPercent },
    recipe: enrichedLines,
  });
});

router.patch("/menu-items/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = UpdateMenuItemParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateMenuItemBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [old] = await db.select().from(menuItemsTable).where(eq(menuItemsTable.id, params.data.id));
  if (!old) { res.status(404).json({ error: "Not found" }); return; }
  if (old.verified && (req as any).userRole !== "admin") { res.status(403).json({ error: "Record is verified. Only admin can modify." }); return; }
  const newName = parsed.data.name ?? old.name;
  const newCategoryId = parsed.data.categoryId !== undefined ? parsed.data.categoryId : old.categoryId;
  const nameChanged = newName !== old.name;
  const categoryChanged = newCategoryId !== old.categoryId;
  if (nameChanged || categoryChanged) {
    const confirmDuplicate = req.body?.confirmDuplicate === true;
    const confirmSimilar = req.body?.confirmSimilar === true;
    const pool = await loadMenuItemPool();
    const matches = findNameDuplicates(newName, newCategoryId ?? null, pool, params.data.id);
    const block = shouldBlockNameDuplicates(matches, confirmDuplicate, confirmSimilar);
    if (block) { res.status(409).json(buildDupeErrorPayload(block.reason, matches, { entity: "menu item", groupLabel: "category" })); return; }
  }
  const [item] = await db.update(menuItemsTable).set(parsed.data).where(eq(menuItemsTable.id, params.data.id)).returning();
  await createAuditLog("menu_items", item.id, "update", old, item);
  const costing = await calculateItemCost(item.id);
  const margin = item.sellingPrice - costing.total;
  const marginPercent = item.sellingPrice > 0 ? (margin / item.sellingPrice) * 100 : 0;
  res.json({ ...item, categoryName: null, productionCost: costing.total, margin, marginPercent });
});

router.delete("/menu-items/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = GetMenuItemParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [existing] = await db.select().from(menuItemsTable).where(eq(menuItemsTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.verified && (req as any).userRole !== "admin") { res.status(403).json({ error: "Record is verified. Only admin can delete." }); return; }

  const [usedInInvoice] = await db.select({ id: salesInvoiceLinesTable.id }).from(salesInvoiceLinesTable).where(eq(salesInvoiceLinesTable.menuItemId, params.data.id)).limit(1);
  if (usedInInvoice) { res.status(400).json({ error: "Cannot delete: this menu item has sales invoice records. Deactivate it instead." }); return; }

  try {
    await db.delete(recipeLinesTable).where(eq(recipeLinesTable.menuItemId, params.data.id));
    const [item] = await db.delete(menuItemsTable).where(eq(menuItemsTable.id, params.data.id)).returning();
    await createAuditLog("menu_items", item.id, "delete", item, null);
    res.json({ success: true });
  } catch (e: any) {
    if (e.code === '23503') { res.status(400).json({ error: "Cannot delete: this menu item is referenced by other records." }); return; }
    throw e;
  }
});

router.patch("/menu-items/:id/verify", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [item] = await db.update(menuItemsTable).set({ verified: true, verifiedBy: (req as any).userId, verifiedAt: new Date() }).where(eq(menuItemsTable.id, id)).returning();
  if (!item) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("menu_items", item.id, "verify", null, item);
  res.json({ ...item, categoryName: null, productionCost: 0, margin: 0, marginPercent: 0 });
});

router.patch("/menu-items/:id/unverify", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [item] = await db.update(menuItemsTable).set({ verified: false, verifiedBy: null, verifiedAt: null }).where(eq(menuItemsTable.id, id)).returning();
  if (!item) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("menu_items", item.id, "unverify", null, item);
  res.json({ ...item, categoryName: null, productionCost: 0, margin: 0, marginPercent: 0 });
});

router.get("/menu-items/:id/recipe", async (req, res): Promise<void> => {
  const params = GetRecipeParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const lines = await db
    .select({
      id: recipeLinesTable.id,
      menuItemId: recipeLinesTable.menuItemId,
      ingredientId: recipeLinesTable.ingredientId,
      ingredientName: ingredientsTable.name,
      quantity: recipeLinesTable.quantity,
      uom: recipeLinesTable.uom,
      wastagePercent: recipeLinesTable.wastagePercent,
      mandatory: recipeLinesTable.mandatory,
      stage: recipeLinesTable.stage,
      notes: recipeLinesTable.notes,
    })
    .from(recipeLinesTable)
    .leftJoin(ingredientsTable, eq(recipeLinesTable.ingredientId, ingredientsTable.id))
    .where(eq(recipeLinesTable.menuItemId, params.data.id));

  const enrichedLines = [];
  for (const line of lines) {
    const { costPerStockUnit, conversionFactor } = await getIngredientCostAndConversion(line.ingredientId);
    const { netQty, costPerRecipeUnit, lineCost } = computeLineCost(costPerStockUnit, conversionFactor, line.quantity, line.wastagePercent || 0);
    enrichedLines.push({ ...line, netQuantity: netQty, costPerUnit: costPerRecipeUnit, lineCost });
  }
  res.json(enrichedLines);
});

router.put("/menu-items/:id/recipe", authMiddleware, async (req, res): Promise<void> => {
  const params = SaveRecipeParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = SaveRecipeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [menuItem] = await db.select().from(menuItemsTable).where(eq(menuItemsTable.id, params.data.id));
  if (!menuItem) { res.status(404).json({ error: "Menu item not found" }); return; }
  if (menuItem.verified && (req as any).userRole !== "admin") { res.status(403).json({ error: "Record is verified. Only admin can modify recipe." }); return; }

  await db.delete(recipeLinesTable).where(eq(recipeLinesTable.menuItemId, params.data.id));

  const insertedLines = [];
  for (const line of parsed.data.lines) {
    const [inserted] = await db.insert(recipeLinesTable).values({
      menuItemId: params.data.id,
      ingredientId: line.ingredientId,
      quantity: line.quantity,
      uom: line.uom,
      wastagePercent: line.wastagePercent ?? 0,
      mandatory: line.mandatory ?? true,
      stage: line.stage,
      notes: line.notes,
    }).returning();

    const [ing] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, line.ingredientId));
    const { costPerStockUnit, conversionFactor } = await getIngredientCostAndConversion(line.ingredientId);
    const { netQty, costPerRecipeUnit, lineCost } = computeLineCost(costPerStockUnit, conversionFactor, inserted.quantity, inserted.wastagePercent || 0);
    insertedLines.push({
      ...inserted,
      ingredientName: ing?.name ?? "",
      netQuantity: netQty,
      costPerUnit: costPerRecipeUnit,
      lineCost,
    });
  }

  await createAuditLog("recipes", params.data.id, "update", null, { lines: insertedLines.length });
  res.json(insertedLines);
});

router.get("/menu-items/:id/costing", async (req, res): Promise<void> => {
  const params = GetMenuItemCostingParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [item] = await db.select().from(menuItemsTable).where(eq(menuItemsTable.id, params.data.id));
  if (!item) { res.status(404).json({ error: "Not found" }); return; }

  const lines = await db
    .select({
      id: recipeLinesTable.id,
      ingredientId: recipeLinesTable.ingredientId,
      ingredientName: ingredientsTable.name,
      quantity: recipeLinesTable.quantity,
      uom: recipeLinesTable.uom,
      wastagePercent: recipeLinesTable.wastagePercent,
    })
    .from(recipeLinesTable)
    .leftJoin(ingredientsTable, eq(recipeLinesTable.ingredientId, ingredientsTable.id))
    .where(eq(recipeLinesTable.menuItemId, params.data.id));

  let ingredientCost = 0;
  const costingLines = [];
  for (const line of lines) {
    const { costPerStockUnit, conversionFactor } = await getIngredientCostAndConversion(line.ingredientId);
    const { netQty, costPerRecipeUnit, lineCost } = computeLineCost(costPerStockUnit, conversionFactor, line.quantity, line.wastagePercent || 0);
    ingredientCost += lineCost;
    costingLines.push({
      ingredientId: line.ingredientId,
      ingredientName: line.ingredientName ?? "",
      quantity: netQty,
      uom: line.uom,
      costPerUnit: costPerRecipeUnit,
      lineCost,
    });
  }

  const margin = item.sellingPrice - ingredientCost;
  const marginPercent = item.sellingPrice > 0 ? (margin / item.sellingPrice) * 100 : 0;

  res.json({
    menuItemId: item.id,
    itemName: item.name,
    sellingPrice: item.sellingPrice,
    ingredientCost,
    packagingCost: 0,
    totalProductionCost: ingredientCost,
    margin,
    marginPercent,
    lines: costingLines,
  });
});

export default router;
