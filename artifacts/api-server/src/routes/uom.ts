import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, uomTable } from "@workspace/db";
import { ListUomResponse, CreateUomBody, UpdateUomParams, UpdateUomBody } from "@workspace/api-zod";
import { authMiddleware } from "../lib/auth";

const router: IRouter = Router();

router.get("/uom", async (_req, res): Promise<void> => {
  const uoms = await db.select().from(uomTable);
  res.json(ListUomResponse.parse(uoms));
});

router.post("/uom", authMiddleware, async (req, res): Promise<void> => {
  const parsed = CreateUomBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [uom] = await db.insert(uomTable).values(parsed.data).returning();
  res.status(201).json(uom);
});

router.patch("/uom/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = UpdateUomParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateUomBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [uom] = await db.update(uomTable).set(parsed.data).where(eq(uomTable.id, params.data.id)).returning();
  if (!uom) { res.status(404).json({ error: "Not found" }); return; }
  res.json(uom);
});

export default router;
