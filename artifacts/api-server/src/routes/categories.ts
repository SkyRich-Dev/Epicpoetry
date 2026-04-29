import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, categoriesTable, menuItemsTable, ingredientsTable } from "@workspace/db";
import { ListCategoriesResponse, CreateCategoryBody, UpdateCategoryParams, UpdateCategoryBody, DeleteCategoryParams, ListCategoriesQueryParams } from "@workspace/api-zod";
import { authMiddleware } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { findNameDuplicates, shouldBlockNameDuplicates, buildDupeErrorPayload, type NameRecord } from "../lib/nameDedupe";

const router: IRouter = Router();

const CATEGORY_TYPE_LABEL: Record<string, string> = {
  ingredient: "Ingredient",
  menu: "Menu",
  expense: "Expense",
};

async function loadCategoryPool(): Promise<NameRecord[]> {
  const rows = await db.select({ id: categoriesTable.id, name: categoriesTable.name, type: categoriesTable.type }).from(categoriesTable);
  return rows.map(r => ({ id: r.id, name: r.name, groupKey: r.type, groupName: CATEGORY_TYPE_LABEL[r.type] ?? r.type }));
}

router.get("/categories", async (req, res): Promise<void> => {
  const query = ListCategoriesQueryParams.safeParse(req.query);
  let categories;
  if (query.success && query.data.type) {
    categories = await db.select().from(categoriesTable).where(eq(categoriesTable.type, query.data.type));
  } else {
    categories = await db.select().from(categoriesTable);
  }
  res.json(ListCategoriesResponse.parse(categories));
});

router.post("/categories", authMiddleware, async (req, res): Promise<void> => {
  const parsed = CreateCategoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const confirmDuplicate = req.body?.confirmDuplicate === true;
  const confirmSimilar = req.body?.confirmSimilar === true;
  const pool = await loadCategoryPool();
  const matches = findNameDuplicates(parsed.data.name, parsed.data.type, pool);
  const block = shouldBlockNameDuplicates(matches, confirmDuplicate, confirmSimilar);
  if (block) { res.status(409).json(buildDupeErrorPayload(block.reason, matches, { entity: "category", groupLabel: "type" })); return; }
  const [cat] = await db.insert(categoriesTable).values({
    name: parsed.data.name,
    type: parsed.data.type,
    description: parsed.data.description,
    active: parsed.data.active ?? true,
    sortOrder: parsed.data.sortOrder ?? 0,
  }).returning();
  await createAuditLog("categories", cat.id, "create", null, cat);
  res.status(201).json(cat);
});

router.patch("/categories/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = UpdateCategoryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateCategoryBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [old] = await db.select().from(categoriesTable).where(eq(categoriesTable.id, params.data.id));
  if (!old) { res.status(404).json({ error: "Not found" }); return; }
  const newName = parsed.data.name ?? old.name;
  const newType = parsed.data.type ?? old.type;
  const nameChanged = newName !== old.name;
  const typeChanged = newType !== old.type;
  if (nameChanged || typeChanged) {
    const confirmDuplicate = req.body?.confirmDuplicate === true;
    const confirmSimilar = req.body?.confirmSimilar === true;
    const pool = await loadCategoryPool();
    const matches = findNameDuplicates(newName, newType, pool, params.data.id);
    const block = shouldBlockNameDuplicates(matches, confirmDuplicate, confirmSimilar);
    if (block) { res.status(409).json(buildDupeErrorPayload(block.reason, matches, { entity: "category", groupLabel: "type" })); return; }
  }
  const [cat] = await db.update(categoriesTable).set(parsed.data).where(eq(categoriesTable.id, params.data.id)).returning();
  if (!cat) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("categories", cat.id, "update", old, cat);
  res.json(cat);
});

router.delete("/categories/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = DeleteCategoryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [usedInMenuItem] = await db.select({ id: menuItemsTable.id }).from(menuItemsTable).where(eq(menuItemsTable.categoryId, params.data.id)).limit(1);
  if (usedInMenuItem) { res.status(400).json({ error: "Cannot delete: this category has menu items." }); return; }

  const [usedInIngredient] = await db.select({ id: ingredientsTable.id }).from(ingredientsTable).where(eq(ingredientsTable.categoryId, params.data.id)).limit(1);
  if (usedInIngredient) { res.status(400).json({ error: "Cannot delete: this category has ingredients." }); return; }

  try {
    await db.delete(categoriesTable).where(eq(categoriesTable.id, params.data.id));
    res.sendStatus(204);
  } catch (e: any) {
    if (e.code === '23503') { res.status(400).json({ error: "Cannot delete: this category is referenced by other records." }); return; }
    throw e;
  }
});

export default router;
