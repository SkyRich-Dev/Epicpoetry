import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, ingredientsTable, categoriesTable, ingredientVendorMappingTable, vendorsTable, recipeLinesTable, purchaseLinesTable } from "@workspace/db";
import { ListIngredientsResponse, CreateIngredientBody, GetIngredientParams, GetIngredientResponse, UpdateIngredientParams, UpdateIngredientBody, ListIngredientVendorMappingsParams, ListIngredientVendorMappingsResponse, CreateIngredientVendorMappingParams, CreateIngredientVendorMappingBody } from "@workspace/api-zod";
import { authMiddleware, adminOnly } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { generateCode } from "../lib/codeGenerator";
import { findDuplicates, describeMatch, type IngredientLite, type DuplicateMatch } from "../lib/ingredientDedupe";

const router: IRouter = Router();

async function loadIngredientPool(): Promise<IngredientLite[]> {
  return await db
    .select({ id: ingredientsTable.id, code: ingredientsTable.code, name: ingredientsTable.name, categoryId: ingredientsTable.categoryId, categoryName: categoriesTable.name })
    .from(ingredientsTable)
    .leftJoin(categoriesTable, eq(ingredientsTable.categoryId, categoriesTable.id));
}

function shouldBlockDuplicates(matches: DuplicateMatch[], confirmDuplicate: boolean, confirmSimilar: boolean): { blocked: DuplicateMatch[]; reason: "exact" | "similar" } | null {
  const exactSame = matches.filter(m => m.matchType === "exact" && m.sameCategory);
  if (exactSame.length > 0) return { blocked: exactSame, reason: "exact" };
  const exactCross = matches.filter(m => m.matchType === "exact" && !m.sameCategory);
  if (exactCross.length > 0 && !confirmDuplicate) return { blocked: exactCross, reason: "exact" };
  const similar = matches.filter(m => m.matchType !== "exact");
  if (similar.length > 0 && !confirmSimilar) return { blocked: similar, reason: "similar" };
  return null;
}

function dupeErrorPayload(reason: "exact" | "similar", matches: DuplicateMatch[]) {
  const isExact = reason === "exact";
  const sameCat = matches.some(m => m.sameCategory && m.matchType === "exact");
  const lead = sameCat
    ? `An ingredient with this name already exists in the same category.`
    : isExact
      ? `An ingredient with this name already exists in another category.`
      : `Possible duplicate of an existing ingredient.`;
  const detail = matches.slice(0, 5).map(describeMatch).join("; ");
  return {
    error: `${lead} ${detail}.`,
    duplicateKind: reason,
    canConfirm: !sameCat,
    duplicates: matches,
  };
}

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
      verified: ingredientsTable.verified,
      verifiedBy: ingredientsTable.verifiedBy,
      verifiedAt: ingredientsTable.verifiedAt,
      createdAt: ingredientsTable.createdAt,
    })
    .from(ingredientsTable)
    .leftJoin(categoriesTable, eq(ingredientsTable.categoryId, categoriesTable.id));
  res.json(ingredients);
});

router.post("/ingredients", authMiddleware, async (req, res): Promise<void> => {
  const parsed = CreateIngredientBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const confirmDuplicate = req.body?.confirmDuplicate === true;
  const confirmSimilar = req.body?.confirmSimilar === true;
  const pool = await loadIngredientPool();
  const matches = findDuplicates(parsed.data.name, parsed.data.categoryId ?? null, pool);
  const blocked = shouldBlockDuplicates(matches, confirmDuplicate, confirmSimilar);
  if (blocked) { res.status(409).json(dupeErrorPayload(blocked.reason, blocked.blocked)); return; }
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
  if (!old) { res.status(404).json({ error: "Not found" }); return; }
  if (old.verified && (req as any).userRole !== "admin") { res.status(403).json({ error: "Record is verified. Only admin can modify." }); return; }
  const nextName = parsed.data.name ?? old.name;
  const nextCategoryId = parsed.data.categoryId !== undefined ? parsed.data.categoryId : old.categoryId;
  const nameChanged = parsed.data.name !== undefined && parsed.data.name.trim().toLowerCase() !== old.name.trim().toLowerCase();
  const categoryChanged = parsed.data.categoryId !== undefined && parsed.data.categoryId !== old.categoryId;
  if (nameChanged || categoryChanged) {
    const confirmDuplicate = req.body?.confirmDuplicate === true;
    const confirmSimilar = req.body?.confirmSimilar === true;
    const pool = await loadIngredientPool();
    const matches = findDuplicates(nextName, nextCategoryId ?? null, pool, old.id);
    const blocked = shouldBlockDuplicates(matches, confirmDuplicate, confirmSimilar);
    if (blocked) { res.status(409).json(dupeErrorPayload(blocked.reason, blocked.blocked)); return; }
  }
  const [ing] = await db.update(ingredientsTable).set(parsed.data).where(eq(ingredientsTable.id, params.data.id)).returning();
  await createAuditLog("ingredients", ing.id, "update", old, ing);
  res.json({ ...ing, categoryName: null });
});

router.delete("/ingredients/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = UpdateIngredientParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [existing] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.verified && (req as any).userRole !== "admin") { res.status(403).json({ error: "Record is verified. Only admin can delete." }); return; }

  const [usedInRecipe] = await db.select({ id: recipeLinesTable.id }).from(recipeLinesTable).where(eq(recipeLinesTable.ingredientId, params.data.id)).limit(1);
  if (usedInRecipe) { res.status(400).json({ error: "Cannot delete: this ingredient is used in recipes." }); return; }

  const [usedInPurchase] = await db.select({ id: purchaseLinesTable.id }).from(purchaseLinesTable).where(eq(purchaseLinesTable.ingredientId, params.data.id)).limit(1);
  if (usedInPurchase) { res.status(400).json({ error: "Cannot delete: this ingredient has purchase records." }); return; }

  try {
    const [ing] = await db.delete(ingredientsTable).where(eq(ingredientsTable.id, params.data.id)).returning();
    await createAuditLog("ingredients", ing.id, "delete", ing, null);
    res.json({ success: true });
  } catch (e: any) {
    if (e.code === '23503') { res.status(400).json({ error: "Cannot delete: this ingredient is referenced by other records." }); return; }
    throw e;
  }
});

router.patch("/ingredients/:id/verify", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [ing] = await db.update(ingredientsTable).set({ verified: true, verifiedBy: (req as any).userId, verifiedAt: new Date() }).where(eq(ingredientsTable.id, id)).returning();
  if (!ing) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("ingredients", ing.id, "verify", null, ing);
  res.json({ ...ing, categoryName: null });
});

router.patch("/ingredients/:id/unverify", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [ing] = await db.update(ingredientsTable).set({ verified: false, verifiedBy: null, verifiedAt: null }).where(eq(ingredientsTable.id, id)).returning();
  if (!ing) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("ingredients", ing.id, "unverify", null, ing);
  res.json({ ...ing, categoryName: null });
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
