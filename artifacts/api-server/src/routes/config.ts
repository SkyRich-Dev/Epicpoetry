import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, pool, systemConfigTable, saasSubscriptionLinkTable } from "@workspace/db";
import { GetConfigResponse, UpdateConfigBody, UpdateConfigResponse } from "@workspace/api-zod";
import { authMiddleware, adminOnly } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function normalizeConfiguredCafeName(value: string | null | undefined): string | null {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "platr") return null;
  return trimmed;
}

async function getPublicCafeName(): Promise<string | null> {
  const publicRows = await pool.query<{ cafe_name: string | null }>("select cafe_name from public.system_config order by id asc limit 1");
  return normalizeConfiguredCafeName(publicRows.rows[0]?.cafe_name ?? null);
}

async function getTenantBrandingSource(tenantSchemaName: string | null | undefined): Promise<string | null> {
  if (!tenantSchemaName) return null;
  const publicCafeName = (await getPublicCafeName())?.toLowerCase() ?? null;
  const [link] = await db.select({
    companyName: saasSubscriptionLinkTable.companyName,
    customerName: saasSubscriptionLinkTable.platrCustomerName,
  })
    .from(saasSubscriptionLinkTable)
    .where(eq(saasSubscriptionLinkTable.tenantSchemaName, tenantSchemaName))
    .limit(1);
  const candidates = [
    normalizeConfiguredCafeName(link?.companyName),
    normalizeConfiguredCafeName(link?.customerName),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (publicCafeName && candidate.toLowerCase() === publicCafeName) continue;
    return candidate;
  }
  return null;
}

async function maybeRepairTenantCafeName(config: typeof systemConfigTable.$inferSelect, tenantSchemaName: string | null | undefined) {
  const tenantBrandName = await getTenantBrandingSource(tenantSchemaName);
  if (!tenantBrandName) return config;

  const currentName = (config.cafeName || "").trim().toLowerCase();
  const publicCafeName = await getPublicCafeName();
  const publicName = (publicCafeName || "").trim().toLowerCase();
  const shouldReplace =
    !currentName ||
    currentName === "platr" ||
    (!!publicName && currentName === publicName);

  if (!shouldReplace) return config;

  const [updated] = await db.update(systemConfigTable)
    .set({ cafeName: tenantBrandName })
    .where(eq(systemConfigTable.id, config.id))
    .returning();

  logger.info({
    event: "tenant.branding.repaired",
    tenantSchemaName: tenantSchemaName ?? null,
    previousCafeName: config.cafeName,
    publicCafeName,
    nextCafeName: tenantBrandName,
    source: "config.get",
  }, "Repaired tenant cafe name from SaaS link");

  return updated ?? config;
}

async function ensureConfig() {
  const configs = await db.select().from(systemConfigTable);
  if (configs.length === 0) {
    const [c] = await db.insert(systemConfigTable).values({}).returning();
    return c;
  }
  return configs[0];
}

router.get("/config", async (req, res): Promise<void> => {
  let config = await ensureConfig();
  config = await maybeRepairTenantCafeName(config, (req as any).tenantSchemaName ?? null);
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
