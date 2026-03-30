import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, categoriesTable } from "@workspace/db";
import { ListCategoriesResponse, CreateCategoryBody, UpdateCategoryParams, UpdateCategoryBody, DeleteCategoryParams, ListCategoriesQueryParams } from "@workspace/api-zod";
import { authMiddleware } from "../lib/auth";
import { createAuditLog } from "../lib/audit";

const router: IRouter = Router();

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
  const [cat] = await db.update(categoriesTable).set(parsed.data).where(eq(categoriesTable.id, params.data.id)).returning();
  if (!cat) { res.status(404).json({ error: "Not found" }); return; }
  await createAuditLog("categories", cat.id, "update", old, cat);
  res.json(cat);
});

router.delete("/categories/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = DeleteCategoryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  await db.delete(categoriesTable).where(eq(categoriesTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
