import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, ingredientsTable, categoriesTable, ingredientVendorMappingTable, vendorsTable } from "@workspace/db";
import { ListIngredientsResponse, CreateIngredientBody, GetIngredientParams, GetIngredientResponse, UpdateIngredientParams, UpdateIngredientBody, ListIngredientVendorMappingsParams, ListIngredientVendorMappingsResponse, CreateIngredientVendorMappingParams, CreateIngredientVendorMappingBody } from "@workspace/api-zod";
import { authMiddleware } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { generateCode } from "../lib/codeGenerator";

const router: IRouter = Router();

router.get("/ingredients", async (_req, res): Promise<void> => {
  const ingredients = await db
    .select({
      id: ingredientsTable.id,
      code: ingredientsTable.code,
      name: ingredientsTable.name,
      categoryId: ingredientsTable.categoryId,
      categoryName: categoriesTable.name,
      description: ingredientsTable.description,
      stockUom: ingredientsTable.stockUom,
      purchaseUom: ingredientsTable.purchaseUom,
      recipeUom: ingredientsTable.recipeUom,
      conversionFactor: ingredientsTable.conversionFactor,
      currentCost: ingredientsTable.currentCost,
      latestCost: ingredientsTable.latestCost,
      weightedAvgCost: ingredientsTable.weightedAvgCost,
      reorderLevel: ingredientsTable.reorderLevel,
      currentStock: ingredientsTable.currentStock,
      perishable: ingredientsTable.perishable,
      shelfLifeDays: ingredientsTable.shelfLifeDays,
      active: ingredientsTable.active,
      createdAt: ingredientsTable.createdAt,
    })
    .from(ingredientsTable)
    .leftJoin(categoriesTable, eq(ingredientsTable.categoryId, categoriesTable.id));
  res.json(ListIngredientsResponse.parse(ingredients));
});

router.post("/ingredients", authMiddleware, async (req, res): Promise<void> => {
  const parsed = CreateIngredientBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const code = await generateCode("ING", "ingredients");
  const [ing] = await db.insert(ingredientsTable).values({
    ...parsed.data,
    code,
    latestCost: parsed.data.currentCost ?? 0,
    weightedAvgCost: parsed.data.currentCost ?? 0,
  }).returning();
  await createAuditLog("ingredients", ing.id, "create", null, ing);
  res.status(201).json({ ...ing, categoryName: null });
});

router.get("/ingredients/:id", async (req, res): Promise<void> => {
  const params = GetIngredientParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [ing] = await db
    .select({
      id: ingredientsTable.id,
      code: ingredientsTable.code,
      name: ingredientsTable.name,
      categoryId: ingredientsTable.categoryId,
      categoryName: categoriesTable.name,
      description: ingredientsTable.description,
      stockUom: ingredientsTable.stockUom,
      purchaseUom: ingredientsTable.purchaseUom,
      recipeUom: ingredientsTable.recipeUom,
      conversionFactor: ingredientsTable.conversionFactor,
      currentCost: ingredientsTable.currentCost,
      latestCost: ingredientsTable.latestCost,
      weightedAvgCost: ingredientsTable.weightedAvgCost,
      reorderLevel: ingredientsTable.reorderLevel,
      currentStock: ingredientsTable.currentStock,
      perishable: ingredientsTable.perishable,
      shelfLifeDays: ingredientsTable.shelfLifeDays,
      active: ingredientsTable.active,
      createdAt: ingredientsTable.createdAt,
    })
    .from(ingredientsTable)
    .leftJoin(categoriesTable, eq(ingredientsTable.categoryId, categoriesTable.id))
    .where(eq(ingredientsTable.id, params.data.id));
  if (!ing) { res.status(404).json({ error: "Not found" }); return; }
  res.json(GetIngredientResponse.parse(ing));
});

router.patch("/ingredients/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = UpdateIngredientParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateIngredientBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [old] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, params.data.id));
  const [ing] = await db.update(ingredientsTable).set(parsed.data).where(eq(ingredientsTable.id, params.data.id)).returning();
  if (!ing) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("ingredients", ing.id, "update", old, ing);
  res.json({ ...ing, categoryName: null });
});

router.delete("/ingredients/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = UpdateIngredientParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [ing] = await db.delete(ingredientsTable).where(eq(ingredientsTable.id, params.data.id)).returning();
  if (!ing) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("ingredients", ing.id, "delete", ing, null);
  res.json({ success: true });
});

router.get("/ingredients/:id/vendor-mappings", async (req, res): Promise<void> => {
  const params = ListIngredientVendorMappingsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const mappings = await db
    .select({
      id: ingredientVendorMappingTable.id,
      ingredientId: ingredientVendorMappingTable.ingredientId,
      vendorId: ingredientVendorMappingTable.vendorId,
      vendorName: vendorsTable.name,
      vendorItemName: ingredientVendorMappingTable.vendorItemName,
      purchaseUom: ingredientVendorMappingTable.purchaseUom,
      conversionFactor: ingredientVendorMappingTable.conversionFactor,
      latestRate: ingredientVendorMappingTable.latestRate,
      taxPercent: ingredientVendorMappingTable.taxPercent,
      landedCost: ingredientVendorMappingTable.landedCost,
      leadTimeDays: ingredientVendorMappingTable.leadTimeDays,
      minOrderQty: ingredientVendorMappingTable.minOrderQty,
      preferred: ingredientVendorMappingTable.preferred,
      active: ingredientVendorMappingTable.active,
    })
    .from(ingredientVendorMappingTable)
    .leftJoin(vendorsTable, eq(ingredientVendorMappingTable.vendorId, vendorsTable.id))
    .where(eq(ingredientVendorMappingTable.ingredientId, params.data.id));
  res.json(ListIngredientVendorMappingsResponse.parse(mappings));
});

router.post("/ingredients/:id/vendor-mappings", authMiddleware, async (req, res): Promise<void> => {
  const params = CreateIngredientVendorMappingParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreateIngredientVendorMappingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const landedCost = parsed.data.latestRate * (1 + (parsed.data.taxPercent ?? 0) / 100);
  const [mapping] = await db.insert(ingredientVendorMappingTable).values({
    ingredientId: params.data.id,
    vendorId: parsed.data.vendorId,
    vendorItemName: parsed.data.vendorItemName,
    purchaseUom: parsed.data.purchaseUom,
    conversionFactor: parsed.data.conversionFactor ?? 1,
    latestRate: parsed.data.latestRate,
    taxPercent: parsed.data.taxPercent ?? 0,
    landedCost,
    leadTimeDays: parsed.data.leadTimeDays,
    minOrderQty: parsed.data.minOrderQty,
    preferred: parsed.data.preferred ?? false,
  }).returning();

  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, parsed.data.vendorId));
  res.status(201).json({ ...mapping, vendorName: vendor?.name ?? "" });
});

export default router;
