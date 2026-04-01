import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, systemConfigTable } from "@workspace/db";
import { GetConfigResponse, UpdateConfigBody, UpdateConfigResponse } from "@workspace/api-zod";
import { authMiddleware, adminOnly } from "../lib/auth";
import { createAuditLog } from "../lib/audit";

const router: IRouter = Router();

async function ensureConfig() {
  const configs = await db.select().from(systemConfigTable);
  if (configs.length === 0) {
    const [c] = await db.insert(systemConfigTable).values({}).returning();
    return c;
  }
  return configs[0];
}

router.get("/config", async (_req, res): Promise<void> => {
  const config = await ensureConfig();
  res.json(GetConfigResponse.parse(config));
});

router.patch("/config", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const parsed = UpdateConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const old = await ensureConfig();
  const [config] = await db.update(systemConfigTable).set(parsed.data).where(eq(systemConfigTable.id, old.id)).returning();
  await createAuditLog("config", config.id, "update", old, config);
  res.json(UpdateConfigResponse.parse(config));
});

export default router;
