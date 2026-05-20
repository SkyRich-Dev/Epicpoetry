import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, trialsTable, trialVersionsTable, trialIngredientLinesTable, categoriesTable, ingredientsTable, menuItemsTable, recipeLinesTable } from "@workspace/db";
import { ListTrialsResponse, CreateTrialBody, GetTrialParams, UpdateTrialParams, UpdateTrialBody, CreateTrialVersionParams, CreateTrialVersionBody, ConvertTrialToMenuItemParams } from "@workspace/api-zod";
import { authMiddleware, requirePermission } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { generateCode } from "../lib/codeGenerator";

const router: IRouter = Router();

router.get("/trials", async (_req, res): Promise<void> => {
  const trials = await db
    .select({
      id: trialsTable.id,
      trialCode: trialsTable.trialCode,
      proposedItemName: trialsTable.proposedItemName,
      categoryId: trialsTable.categoryId,
      categoryName: categoriesTable.name,
      targetCost: trialsTable.targetCost,
      targetSellingPrice: trialsTable.targetSellingPrice,
      status: trialsTable.status,
      notes: trialsTable.notes,
      createdAt: trialsTable.createdAt,
    })
    .from(trialsTable)
    .leftJoin(categoriesTable, eq(trialsTable.categoryId, categoriesTable.id));
  res.json(ListTrialsResponse.parse(trials));
});

router.post("/trials", authMiddleware, requirePermission("menu_items.edit"), async (req, res): Promise<void> => {
  const parsed = CreateTrialBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const trialCode = await generateCode("TRL", "trials");
  const [trial] = await db.insert(trialsTable).values({ ...parsed.data, trialCode }).returning();
  await createAuditLog("trials", trial.id, "create", null, trial);
  res.status(201).json({ ...trial, categoryName: null });
});

router.get("/trials/:id", async (req, res): Promise<void> => {
  const params = GetTrialParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [trial] = await db
    .select({
      id: trialsTable.id,
      trialCode: trialsTable.trialCode,
      proposedItemName: trialsTable.proposedItemName,
      categoryId: trialsTable.categoryId,
      categoryName: categoriesTable.name,
      targetCost: trialsTable.targetCost,
      targetSellingPrice: trialsTable.targetSellingPrice,
      status: trialsTable.status,
      notes: trialsTable.notes,
      createdAt: trialsTable.createdAt,
    })
    .from(trialsTable)
    .leftJoin(categoriesTable, eq(trialsTable.categoryId, categoriesTable.id))
    .where(eq(trialsTable.id, params.data.id));

  if (!trial) { res.status(404).json({ error: "Not found" }); return; }

  const versions = await db.select().from(trialVersionsTable).where(eq(trialVersionsTable.trialId, params.data.id));

  const enrichedVersions = [];
  for (const v of versions) {
    const lines = await db
      .select({
        ingredientId: trialIngredientLinesTable.ingredientId,
        ingredientName: ingredientsTable.name,
        plannedQty: trialIngredientLinesTable.plannedQty,
        actualQty: trialIngredientLinesTable.actualQty,
        uom: trialIngredientLinesTable.uom,
        wastageQty: trialIngredientLinesTable.wastageQty,
        costPerUnit: trialIngredientLinesTable.costPerUnit,
        totalCost: trialIngredientLinesTable.totalCost,
      })
      .from(trialIngredientLinesTable)
      .leftJoin(ingredientsTable, eq(trialIngredientLinesTable.ingredientId, ingredientsTable.id))
      .where(eq(trialIngredientLinesTable.trialVersionId, v.id));
    enrichedVersions.push({ ...v, trialDate: v.trialDate, inventoryDeducted: v.inventoryDeducted, ingredients: lines });
  }

  res.json({ trial, versions: enrichedVersions });
});

router.patch("/trials/:id", authMiddleware, requirePermission("menu_items.edit"), async (req, res): Promise<void> => {
  const params = UpdateTrialParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateTrialBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [trial] = await db.update(trialsTable).set(parsed.data).where(eq(trialsTable.id, params.data.id)).returning();
  if (!trial) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("trials", trial.id, "update", null, trial);
  res.json({ ...trial, categoryName: null });
});

router.delete("/trials/:id", authMiddleware, requirePermission("menu_items.edit"), async (req, res): Promise<void> => {
  const params = UpdateTrialParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [trial] = await db.delete(trialsTable).where(eq(trialsTable.id, params.data.id)).returning();
  if (!trial) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("trials", trial.id, "delete", trial, null);
  res.json({ success: true });
});

router.post("/trials/:id/versions", authMiddleware, requirePermission("menu_items.edit"), async (req, res): Promise<void> => {
  const params = CreateTrialVersionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreateTrialVersionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const existingVersions = await db.select().from(trialVersionsTable).where(eq(trialVersionsTable.trialId, params.data.id));
  const versionNumber = existingVersions.length + 1;

  let totalCost = 0;
  const ingredientData: any[] = [];
  for (const ingLine of parsed.data.ingredients) {
    const [ing] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, ingLine.ingredientId));
    if (!ing) { res.status(400).json({ error: `Ingredient #${ingLine.ingredientId} not found` }); return; }
    const costPerStockUnit = ing.weightedAvgCost;
    const conversionFactor = ing.conversionFactor || 1;
    const costPerUnit = costPerStockUnit / conversionFactor;
    const actualUsed = ingLine.actualQty + (ingLine.wastageQty ?? 0);
    const lineCost = costPerUnit * actualUsed;
    totalCost += lineCost;
    ingredientData.push({
      ...ingLine, costPerUnit, totalCost: lineCost,
      ingredientName: ing.name, currentStock: ing.currentStock,
      stockUom: ing.stockUom, conversionFactor,
    });
  }

  const costPerUnit = parsed.data.yieldQty > 0 ? totalCost / parsed.data.yieldQty : 0;
  const trialDate = parsed.data.trialDate || new Date().toISOString().split("T")[0];

  const result = await db.transaction(async (tx) => {
    const [version] = await tx.insert(trialVersionsTable).values({
      trialId: params.data.id,
      versionNumber,
      trialDate,
      batchSize: parsed.data.batchSize,
      yieldQty: parsed.data.yieldQty,
      yieldUom: parsed.data.yieldUom,
      prepTime: parsed.data.prepTime,
      totalCost,
      costPerUnit,
      status: parsed.data.status ?? "draft",
      tasteScore: parsed.data.tasteScore,
      appearanceScore: parsed.data.appearanceScore,
      consistencyScore: parsed.data.consistencyScore,
      notes: parsed.data.notes,
      inventoryDeducted: 1,
    }).returning();

    for (const ingLine of ingredientData) {
      await tx.insert(trialIngredientLinesTable).values({
        trialVersionId: version.id,
        ingredientId: ingLine.ingredientId,
        plannedQty: ingLine.plannedQty,
        actualQty: ingLine.actualQty,
        uom: ingLine.uom,
        wastageQty: ingLine.wastageQty ?? 0,
        costPerUnit: ingLine.costPerUnit,
        totalCost: ingLine.totalCost,
      });
    }

    const deductionMap = new Map<number, number>();
    for (const ingLine of ingredientData) {
      const actualUsed = ingLine.actualQty + (ingLine.wastageQty ?? 0);
      const stockDeduction = actualUsed / ingLine.conversionFactor;
      deductionMap.set(ingLine.ingredientId, (deductionMap.get(ingLine.ingredientId) || 0) + stockDeduction);
    }
    for (const [ingId, totalDeduction] of deductionMap) {
      const [fresh] = await tx.select().from(ingredientsTable).where(eq(ingredientsTable.id, ingId));
      if (fresh) {
        const newStock = Math.max(0, fresh.currentStock - totalDeduction);
        await tx.update(ingredientsTable).set({ currentStock: newStock }).where(eq(ingredientsTable.id, ingId));
      }
    }

    return version;
  });

  await createAuditLog("trials", params.data.id, "version_created", null, { versionNumber, totalCost, ingredientsUsed: ingredientData.length, inventoryDeducted: true });
  res.status(201).json({ ...result, ingredients: ingredientData });
});

router.post("/trials/:trialId/versions/:versionId/convert", authMiddleware, requirePermission("menu_items.edit"), async (req, res): Promise<void> => {
  const trialId = Number(Array.isArray(req.params.trialId) ? req.params.trialId[0] : req.params.trialId);
  const versionId = Number(Array.isArray(req.params.versionId) ? req.params.versionId[0] : req.params.versionId);

  const [trial] = await db.select().from(trialsTable).where(eq(trialsTable.id, trialId));
  if (!trial) { res.status(404).json({ error: "Trial not found" }); return; }

  const [version] = await db.select().from(trialVersionsTable).where(eq(trialVersionsTable.id, versionId));
  if (!version) { res.status(404).json({ error: "Version not found" }); return; }

  const code = await generateCode("MNU", "menu_items");
  const [menuItem] = await db.insert(menuItemsTable).values({
    code,
    name: trial.proposedItemName,
    categoryId: trial.categoryId,
    sellingPrice: trial.targetSellingPrice ?? 0,
  }).returning();

  const ingredientLines = await db.select().from(trialIngredientLinesTable).where(eq(trialIngredientLinesTable.trialVersionId, versionId));
  for (const line of ingredientLines) {
    const qtyPerUnit = version.yieldQty > 0 ? line.actualQty / version.yieldQty : line.actualQty;
    await db.insert(recipeLinesTable).values({
      menuItemId: menuItem.id,
      ingredientId: line.ingredientId,
      quantity: qtyPerUnit,
      uom: line.uom,
      wastagePercent: 0,
      mandatory: true,
    });
  }

  await db.update(trialsTable).set({ status: "approved" }).where(eq(trialsTable.id, trialId));
  await createAuditLog("trials", trialId, "converted_to_menu", null, { menuItemId: menuItem.id });

  res.json({ ...menuItem, categoryName: null, productionCost: version.costPerUnit, margin: (trial.targetSellingPrice ?? 0) - version.costPerUnit, marginPercent: 0 });
});

export default router;
