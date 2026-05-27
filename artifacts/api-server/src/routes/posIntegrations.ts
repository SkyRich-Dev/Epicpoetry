import { Router, type IRouter } from "express";
import { db, posIntegrationsTable, posSyncLogsTable, posWebhookEventsTable, menuItemsTable, categoriesTable,
  salesInvoicesTable, salesImportBatchesTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { authMiddleware, adminOnly } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { importPetpoojaOrder, upsertPetpoojaCustomer } from "../lib/petpoojaImporter";
import { runWithTenantSchema } from "../lib/saas";
import { fetchFromPos, getProviderCapabilities, POS_DATA_TYPES, POS_DATA_TYPE_LABELS,
  PosFetchError, type PosDataType } from "../lib/posProviders";
import { isValidIsoDate } from "../lib/dateValidation";
import crypto from "crypto";

const router: IRouter = Router();

function redactSecrets(obj: any) {
  if (!obj) return obj;
  const redacted = { ...obj };
  if (redacted.apiKey) redacted.apiKey = "****";
  if (redacted.apiSecret) redacted.apiSecret = "****";
  if (redacted.webhookSecret) redacted.webhookSecret = "****";
  if (redacted.accessToken) redacted.accessToken = "****";
  return redacted;
}

function getProvidedWebhookToken(payload: any, headers: Record<string, any>) {
  return payload?.token || payload?.Token || headers["x-webhook-secret"] || headers["x-webhook-token"] || null;
}

function maskToken(token: unknown) {
  const text = String(token || "").trim();
  if (!text) return null;
  return text.length <= 4 ? `****${text}` : `****${text.slice(-4)}`;
}

function sanitizeWebhookPayload(payload: any): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { raw: payload };
  }
  const clone = JSON.parse(JSON.stringify(payload));
  if (clone.token !== undefined) clone.token = "[REDACTED]";
  if (clone.Token !== undefined) clone.Token = "[REDACTED]";
  return clone;
}

function maskSecretValue(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.length <= 4 ? "****" : `****${text.slice(-4)}`;
}

function summarizePosIntegrationPayload(body: Record<string, unknown>) {
  return {
    name: body.name,
    provider: body.provider,
    restaurantId: body.restaurantId,
    baseUrl: body.baseUrl,
    autoSync: body.autoSync,
    syncMenuItems: body.syncMenuItems,
    syncOrders: body.syncOrders,
    defaultGstPercent: body.defaultGstPercent,
    defaultOrderType: body.defaultOrderType,
    hasApiKey: !!String(body.apiKey || "").trim(),
    hasApiSecret: !!String(body.apiSecret || "").trim(),
    accessTokenHint: maskSecretValue(body.accessToken),
  };
}

function buildPosIntegrationError(err: any) {
  const message = String(err?.message || "Unknown error");
  const code = String(err?.code || "");

  if (code === "42703" || code === "42P01" || /column .* does not exist/i.test(message) || /relation .* does not exist/i.test(message)) {
    return {
      status: 500,
      body: {
        success: false,
        message: "POS integration schema is out of date. Run the EpicPoetry database migration before creating integrations.",
        errorCode: "POS_INTEGRATION_MIGRATION_REQUIRED",
      },
    };
  }

  if (code === "23502") {
    return {
      status: 400,
      body: {
        success: false,
        message: "A required POS integration field is missing.",
        errorCode: "POS_INTEGRATION_REQUIRED_FIELD_MISSING",
      },
    };
  }

  if (code === "23505") {
    return {
      status: 409,
      body: {
        success: false,
        message: "A POS integration with this unique value already exists.",
        errorCode: "POS_INTEGRATION_DUPLICATE",
      },
    };
  }

  return {
    status: 500,
    body: {
      success: false,
      message: "Failed to create POS integration.",
      errorCode: "POS_INTEGRATION_CREATE_FAILED",
    },
  };
}

function generatePublicWebhookKey(): string {
  return crypto.randomBytes(18).toString("hex");
}

function normalizeTenantSchemaName(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(normalized)) return null;
  if (normalized.startsWith("pg_") || normalized === "information_schema") return null;
  return normalized;
}

function isPublicSchemaName(value: string | null | undefined): boolean {
  return String(value || "").trim().toLowerCase() === "public";
}

function resolveIntegrationSchemaName(value: string | null | undefined): string | null {
  const normalized = normalizeTenantSchemaName(value);
  if (!normalized || isPublicSchemaName(normalized)) return null;
  return normalized;
}

function effectiveWebhookSchemaName(value: string | null | undefined): string {
  return resolveIntegrationSchemaName(value) || "public";
}

async function ensureWebhookIdentity(integration: any, tenantSchemaName?: string | null) {
  const updates: Record<string, string> = {};
  const normalizedSchema = resolveIntegrationSchemaName(tenantSchemaName);

  if (!integration.publicWebhookKey) {
    updates.publicWebhookKey = generatePublicWebhookKey();
  }
  if (!integration.tenantSchemaName && normalizedSchema) {
    updates.tenantSchemaName = normalizedSchema;
  }

  if (Object.keys(updates).length === 0) {
    return integration;
  }

  const [updated] = await db.update(posIntegrationsTable)
    .set(updates)
    .where(eq(posIntegrationsTable.id, integration.id))
    .returning();

  return updated ?? { ...integration, ...updates };
}

async function createWebhookEvent(input: {
  integrationId: number;
  provider: string;
  payload: any;
  status: string;
  message?: string;
  tokenHint?: string | null;
}) {
  const order = input.payload?.properties?.Order || input.payload?.Order || null;
  const [row] = await db.insert(posWebhookEventsTable).values({
    integrationId: input.integrationId,
    provider: input.provider,
    eventType: input.payload?.event || null,
    externalOrderId: order?.orderID ? String(order.orderID) : null,
    customerInvoiceId: order?.customer_invoice_id ? String(order.customer_invoice_id) : null,
    status: input.status,
    message: input.message || null,
    tokenHint: input.tokenHint || null,
    payload: sanitizeWebhookPayload(input.payload),
  }).returning();
  return row;
}

async function updateWebhookEvent(id: number, updates: {
  status?: string;
  message?: string;
  invoiceNo?: string | null;
  salesInvoiceId?: number | null;
  responsePayload?: Record<string, unknown> | null;
}) {
  await db.update(posWebhookEventsTable).set({
    status: updates.status,
    message: updates.message,
    invoiceNo: updates.invoiceNo,
    salesInvoiceId: updates.salesInvoiceId,
    responsePayload: updates.responsePayload,
  }).where(eq(posWebhookEventsTable.id, id));
}

router.get("/pos-integrations", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const tenantSchemaName = (req as any).tenantSchemaName as string | undefined;
  const integrations = await db.select().from(posIntegrationsTable).orderBy(posIntegrationsTable.createdAt);
  const hydrated = await Promise.all(integrations.map((integration) => ensureWebhookIdentity(integration, tenantSchemaName)));
  const safe = hydrated.map(i => ({
    ...i,
    apiKey: i.apiKey ? `****${i.apiKey.slice(-4)}` : null,
    apiSecret: i.apiSecret ? "****" : null,
    webhookSecret: i.webhookSecret ? `****${i.webhookSecret.slice(-4)}` : null,
    accessToken: i.accessToken ? "****" : null,
  }));
  res.json(safe);
});

router.get("/pos-integrations/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [rawIntegration] = await db.select().from(posIntegrationsTable).where(eq(posIntegrationsTable.id, id));
  const integration = rawIntegration ? await ensureWebhookIdentity(rawIntegration, (req as any).tenantSchemaName as string | undefined) : null;
  if (!integration) { res.status(404).json({ error: "Not found" }); return; }
  res.json({
    ...integration,
    apiSecret: integration.apiSecret ? "****" : null,
    webhookSecret: integration.webhookSecret ? `****${integration.webhookSecret.slice(-4)}` : null,
    accessToken: integration.accessToken ? "****" : null,
  });
});

router.post("/pos-integrations", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const { name, provider, apiKey, apiSecret, restaurantId, baseUrl, accessToken,
    autoSync, syncMenuItems, syncOrders, defaultGstPercent, defaultOrderType } = req.body;
  if (!name || !provider) {
    res.status(400).json({ success: false, message: "name and provider are required", errorCode: "POS_INTEGRATION_VALIDATION_FAILED" });
    return;
  }

  const tenantSchemaName = resolveIntegrationSchemaName((req as any).tenantSchemaName);
  req.log?.info({
    event: "pos_integration.create.request",
    tenantSchemaName,
    userId: (req as any).userId,
    userRole: (req as any).userRole,
    payload: summarizePosIntegrationPayload(req.body || {}),
  });

  try {
    const webhookSecret = crypto.randomBytes(32).toString("hex");
    const publicWebhookKey = generatePublicWebhookKey();
    req.log?.info({
      event: "pos_integration.create.generated",
      tenantSchemaName,
      provider,
      publicWebhookKeySuffix: publicWebhookKey.slice(-8),
      webhookSecretSuffix: webhookSecret.slice(-8),
    });

    const [integration] = await db.insert(posIntegrationsTable).values({
      name, provider,
      apiKey: apiKey || null,
      apiSecret: apiSecret || null,
      webhookSecret,
      publicWebhookKey,
      tenantSchemaName,
      restaurantId: restaurantId || null,
      baseUrl: baseUrl || null,
      accessToken: accessToken || null,
      autoSync: autoSync ?? false,
      syncMenuItems: syncMenuItems ?? true,
      syncOrders: syncOrders ?? true,
      defaultGstPercent: defaultGstPercent ?? 5,
      defaultOrderType: defaultOrderType || "dine-in",
    }).returning();

    req.log?.info({
      event: "pos_integration.create.inserted",
      tenantSchemaName,
      integrationId: integration.id,
      provider: integration.provider,
      restaurantId: integration.restaurantId,
      publicWebhookKeySuffix: integration.publicWebhookKey?.slice(-8) ?? null,
    });

    await createAuditLog("pos_integrations", integration.id, "create", null, redactSecrets(integration));
    res.status(201).json({
      ...integration,
      apiSecret: integration.apiSecret ? "****" : null,
      accessToken: integration.accessToken ? "****" : null,
    });
  } catch (err: any) {
    req.log?.error({
      err,
      event: "pos_integration.create.failed",
      tenantSchemaName,
      userId: (req as any).userId,
      provider,
      payload: summarizePosIntegrationPayload(req.body || {}),
      dbCode: err?.code,
    }, "Failed to create POS integration");
    const mapped = buildPosIntegrationError(err);
    res.status(mapped.status).json(mapped.body);
  }
});

router.patch("/pos-integrations/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [old] = await db.select().from(posIntegrationsTable).where(eq(posIntegrationsTable.id, id));
  if (!old) { res.status(404).json({ error: "Not found" }); return; }

  const updates: any = {};
  const fields = ["name", "provider", "apiKey", "apiSecret", "restaurantId", "baseUrl", "accessToken",
    "autoSync", "syncMenuItems", "syncOrders", "defaultGstPercent", "defaultOrderType", "active"];
  for (const f of fields) if (req.body[f] !== undefined) updates[f] = req.body[f];

  const [updated] = await db.update(posIntegrationsTable).set(updates).where(eq(posIntegrationsTable.id, id)).returning();
  await createAuditLog("pos_integrations", id, "update", redactSecrets(old), redactSecrets(updated));
  res.json({
    ...updated,
    apiSecret: updated.apiSecret ? "****" : null,
    webhookSecret: updated.webhookSecret ? `****${updated.webhookSecret.slice(-4)}` : null,
    accessToken: updated.accessToken ? "****" : null,
  });
});

router.delete("/pos-integrations/:id", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(posIntegrationsTable).where(eq(posIntegrationsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  await db.delete(posIntegrationsTable).where(eq(posIntegrationsTable.id, id));
  await createAuditLog("pos_integrations", id, "delete", redactSecrets(existing), null);
  res.json({ message: "Deleted" });
});

router.post("/pos-integrations/:id/regenerate-webhook-secret", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(posIntegrationsTable).where(eq(posIntegrationsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const webhookSecret = crypto.randomBytes(32).toString("hex");
  await db.update(posIntegrationsTable).set({ webhookSecret }).where(eq(posIntegrationsTable.id, id));
  res.json({ webhookSecret });
});

router.get("/pos-integrations/:id/webhook-secret", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(posIntegrationsTable).where(eq(posIntegrationsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ webhookSecret: existing.webhookSecret });
});

router.post("/pos-integrations/:id/test-connection", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [integration] = await db.select().from(posIntegrationsTable).where(eq(posIntegrationsTable.id, id));
  if (!integration) { res.status(404).json({ error: "Not found" }); return; }

  if (integration.provider === "petpooja") {
    if (!integration.accessToken) {
      res.json({ success: false, message: "Access token not configured. Petpooja webhook will still work if webhook secret is set." });
      return;
    }
    try {
      const testUrl = integration.baseUrl || "https://api.petpooja.com";
      res.json({
        success: true,
        message: `Petpooja integration configured. Webhook endpoint ready. Restaurant ID: ${integration.restaurantId || 'Not set'}`,
        provider: "petpooja",
        webhookReady: !!integration.webhookSecret,
      });
    } catch (e: any) {
      res.json({ success: false, message: e.message });
    }
    return;
  }

  res.json({ success: true, message: `Integration "${integration.name}" is active.` });
});

router.get("/pos-integrations/:id/stats", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [integration] = await db.select().from(posIntegrationsTable).where(eq(posIntegrationsTable.id, id));
  if (!integration) { res.status(404).json({ error: "Not found" }); return; }

  if (integration.provider === "petpooja") {
    const batches = await db.select().from(salesImportBatchesTable)
      .where(eq(salesImportBatchesTable.sourceType, "petpooja"))
      .orderBy(sql`${salesImportBatchesTable.createdAt} DESC`)
      .limit(5);

    const invoiceCount = await db.select({ count: sql<number>`count(*)::int` })
      .from(salesInvoicesTable)
      .where(eq(salesInvoicesTable.sourceType, "petpooja"));

    const autoCreatedMenuItems = await db.select({ count: sql<number>`count(*)::int` })
      .from(menuItemsTable)
      .where(sql`${menuItemsTable.code} LIKE 'PP%'`);

    res.json({
      totalInvoicesImported: invoiceCount[0]?.count || 0,
      autoCreatedMenuItems: autoCreatedMenuItems[0]?.count || 0,
      totalOrdersSynced: integration.totalOrdersSynced,
      lastSync: integration.lastSyncAt,
      lastSyncStatus: integration.lastSyncStatus,
      recentBatches: batches,
    });
    return;
  }

  res.json({ totalOrdersSynced: integration.totalOrdersSynced, lastSync: integration.lastSyncAt });
});

async function handlePetpoojaWebhook(req: any, res: any): Promise<void> {
  const tenantSchemaName = resolveIntegrationSchemaName(req.params.tenantSchemaName);
  const publicWebhookKey = String(req.params.publicWebhookKey || "").trim();

  if (!publicWebhookKey) {
    res.status(400).json({ error: "Invalid webhook URL" });
    return;
  }

  const schemaNameForRequest = effectiveWebhookSchemaName(tenantSchemaName);

  req.log?.info({
    event: "petpooja.webhook.received",
    tenantSchemaName: schemaNameForRequest,
    publicWebhookKeySuffix: publicWebhookKey.slice(-8),
    provider: "petpooja",
  });

  await runWithTenantSchema(schemaNameForRequest, async () => {
    const [rawIntegration] = await db.select().from(posIntegrationsTable).where(
      tenantSchemaName
        ? and(
            eq(posIntegrationsTable.publicWebhookKey, publicWebhookKey),
            eq(posIntegrationsTable.provider, "petpooja"),
            eq(posIntegrationsTable.tenantSchemaName, tenantSchemaName),
          )
        : and(
            eq(posIntegrationsTable.publicWebhookKey, publicWebhookKey),
            eq(posIntegrationsTable.provider, "petpooja"),
            sql`${posIntegrationsTable.tenantSchemaName} IS NULL OR lower(${posIntegrationsTable.tenantSchemaName}) = 'public'`,
          )
    );
    const integration = rawIntegration ? await ensureWebhookIdentity(rawIntegration, tenantSchemaName) : null;
    if (!integration || !integration.active) {
      req.log?.warn({
        event: "petpooja.webhook.integration_not_found",
        tenantSchemaName: schemaNameForRequest,
        publicWebhookKeySuffix: publicWebhookKey.slice(-8),
      });
      res.status(404).json({ error: "Integration not found or inactive" });
      return;
    }

    const payload = req.body;
    const providedToken = getProvidedWebhookToken(payload, req.headers || {});
    const webhookEvent = await createWebhookEvent({
      integrationId: integration.id,
      provider: integration.provider,
      payload,
      status: "received",
      tokenHint: maskToken(providedToken),
    });

    if (integration.webhookSecret) {
      if (!providedToken || providedToken !== integration.webhookSecret) {
        await updateWebhookEvent(webhookEvent.id, {
          status: "invalid_auth",
          message: "Invalid webhook token",
          responsePayload: { success: false, error: "Invalid webhook token" },
        });
        res.status(401).json({ error: "Invalid webhook token" });
        return;
      }
    }

    if (payload?.event !== "orderdetails" || !payload?.properties) {
      await updateWebhookEvent(webhookEvent.id, {
        status: "invalid_payload",
        message: "Invalid payload: expected event=orderdetails with properties",
        responsePayload: { success: false, error: "Invalid payload: expected event=orderdetails with properties" },
      });
      res.status(400).json({ error: "Invalid payload: expected event=orderdetails with properties" });
      return;
    }

    const props = payload.properties;
    const ppOrder = props.Order;
    const ppItems = props.OrderItem;
    const ppCustomer = props.Customer;

    if (!ppOrder || !ppItems || !Array.isArray(ppItems) || ppItems.length === 0) {
      await updateWebhookEvent(webhookEvent.id, {
        status: "invalid_payload",
        message: "Missing Order or OrderItem in payload",
        responsePayload: { success: false, error: "Missing Order or OrderItem in payload" },
      });
      res.status(400).json({ error: "Missing Order or OrderItem in payload" });
      return;
    }

    try {
      const result = await importPetpoojaOrder({ ppOrder, ppItems, ppCustomer, integration });
      if (!result.created) {
        req.log?.info({
          event: "petpooja.webhook.duplicate",
          tenantSchemaName: schemaNameForRequest,
          integrationId: integration.id,
          invoiceNo: result.invoiceNo,
        });
        await updateWebhookEvent(webhookEvent.id, {
          status: "skipped",
          message: `Order ${result.invoiceNo} was already imported`,
          invoiceNo: result.invoiceNo,
          responsePayload: { success: true, skipped: true, invoiceNo: result.invoiceNo },
        });
        res.json({ success: true, skipped: true, message: `Order ${result.invoiceNo} was already imported`, invoiceNo: result.invoiceNo });
        return;
      }

      const [invoice] = await db.select({ id: salesInvoicesTable.id })
        .from(salesInvoicesTable)
        .where(and(eq(salesInvoicesTable.invoiceNo, result.invoiceNo), eq(salesInvoicesTable.sourceType, "petpooja")))
        .limit(1);
      await updateWebhookEvent(webhookEvent.id, {
        status: "processed",
        message: `Order ${result.invoiceNo} processed successfully`,
        invoiceNo: result.invoiceNo,
        salesInvoiceId: invoice?.id || null,
        responsePayload: {
          success: true,
          invoiceNo: result.invoiceNo,
          autoCreated: result.autoCreated,
        },
      });
      req.log?.info({
        event: "petpooja.webhook.processed",
        tenantSchemaName: schemaNameForRequest,
        integrationId: integration.id,
        invoiceNo: result.invoiceNo,
        salesInvoiceId: invoice?.id ?? null,
        autoCreated: result.autoCreated,
      });
      res.json({
        success: true,
        message: `Order ${result.invoiceNo} processed successfully`,
        autoCreated: result.autoCreated.length > 0 ? result.autoCreated : undefined,
      });
    } catch (e: any) {
      req.log?.error({
        err: e,
        event: "petpooja.webhook.failed",
        tenantSchemaName: schemaNameForRequest,
        integrationId: integration.id,
        restaurantId: integration.restaurantId,
      }, "Petpooja webhook processing failed");
      await updateSyncStatusFailed(integration.id);
      await updateWebhookEvent(webhookEvent.id, {
        status: "failed",
        message: `Order processing failed: ${e.message}`,
        responsePayload: { success: false, error: e.message || "Order processing failed" },
      });
      res.status(500).json({ success: false, message: `Order processing failed: ${e.message}` });
    }
  });
}

router.post("/webhook/petpooja/:tenantSchemaName/:publicWebhookKey", async (req, res): Promise<void> => {
  await handlePetpoojaWebhook(req, res);
});

router.post("/webhook/petpooja/:publicWebhookKey", async (req, res): Promise<void> => {
  req.params.tenantSchemaName = "public";
  await handlePetpoojaWebhook(req, res);
});

router.post("/webhook/petpooja-global/:tenantSchemaName/:publicWebhookKey", async (req, res): Promise<void> => {
  await handlePetpoojaWebhook(req, res);
});

router.post("/webhook/petpooja-global/:publicWebhookKey", async (req, res): Promise<void> => {
  req.params.tenantSchemaName = "public";
  await handlePetpoojaWebhook(req, res);
});

async function updateSyncStatusFailed(integrationId: number) {
  await db.update(posIntegrationsTable).set({
    lastSyncAt: new Date(),
    lastSyncStatus: "failed",
    lastSyncMessage: "1 failed",
  }).where(eq(posIntegrationsTable.id, integrationId));
}

// === Manual fetch capabilities + endpoints ===

router.get("/pos-integrations/:id/capabilities", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [integration] = await db.select().from(posIntegrationsTable).where(eq(posIntegrationsTable.id, id));
  if (!integration) { res.status(404).json({ error: "Not found" }); return; }
  const matrix = getProviderCapabilities(integration.provider);
  const dataTypes = POS_DATA_TYPES.map((dt) => ({
    key: dt,
    label: POS_DATA_TYPE_LABELS[dt],
    status: matrix[dt].status,
    hint: matrix[dt].hint,
  }));
  res.json({ provider: integration.provider, dataTypes });
});

router.get("/pos-integrations/:id/sync-logs", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const rawLimit = req.query.limit;
  let limit = 20;
  if (rawLimit !== undefined) {
    const n = Number(rawLimit);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      res.status(400).json({ error: "limit must be an integer between 1 and 100" }); return;
    }
    limit = n;
  }
  const [integration] = await db.select().from(posIntegrationsTable).where(eq(posIntegrationsTable.id, id));
  if (!integration) { res.status(404).json({ error: "Not found" }); return; }
  const rows = await db.select().from(posSyncLogsTable)
    .where(eq(posSyncLogsTable.integrationId, id))
    .orderBy(desc(posSyncLogsTable.createdAt))
    .limit(limit);
  res.json({ logs: rows });
});

router.get("/pos-integrations/:id/webhook-events", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const rawLimit = req.query.limit;
  let limit = 20;
  if (rawLimit !== undefined) {
    const n = Number(rawLimit);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      res.status(400).json({ error: "limit must be an integer between 1 and 100" }); return;
    }
    limit = n;
  }
  const [integration] = await db.select().from(posIntegrationsTable).where(eq(posIntegrationsTable.id, id));
  if (!integration) { res.status(404).json({ error: "Not found" }); return; }
  const rows = await db.select().from(posWebhookEventsTable)
    .where(eq(posWebhookEventsTable.integrationId, id))
    .orderBy(desc(posWebhookEventsTable.createdAt))
    .limit(limit);
  res.json({ events: rows });
});

const FETCH_RATE_LIMIT_MS = 30_000;

router.post("/pos-integrations/:id/fetch", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [integration] = await db.select().from(posIntegrationsTable).where(eq(posIntegrationsTable.id, id));
  if (!integration) { res.status(404).json({ error: "Not found" }); return; }
  if (!integration.active) { res.status(400).json({ error: "Integration is inactive" }); return; }

  const { dataTypes, from, to } = req.body || {};
  if (!Array.isArray(dataTypes) || dataTypes.length === 0) {
    res.status(400).json({ error: "dataTypes (array of POS data types) is required" }); return;
  }
  for (const dt of dataTypes) {
    if (!POS_DATA_TYPES.includes(dt)) {
      res.status(400).json({ error: `Unknown data type: ${dt}` }); return;
    }
  }
  if (!from || !to) {
    res.status(400).json({ error: "from and to dates are required (YYYY-MM-DD)" }); return;
  }
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
    res.status(400).json({ error: "Dates must be valid calendar dates in YYYY-MM-DD format" }); return;
  }
  const fromMs = Date.parse(from + "T00:00:00Z");
  const toMs = Date.parse(to + "T23:59:59Z");
  const todayMs = Date.parse(new Date().toISOString().split("T")[0] + "T23:59:59Z");
  if (fromMs > toMs) {
    res.status(400).json({ error: "from must be on or before to" }); return;
  }
  if (toMs > todayMs) {
    res.status(400).json({ error: "to date cannot be in the future" }); return;
  }
  const rangeDays = Math.ceil((toMs - fromMs) / 86_400_000) + 1;
  if (rangeDays > 90) {
    res.status(400).json({ error: "Date range cannot exceed 90 days" }); return;
  }

  // Atomic rate-limit acquisition: a single UPDATE...WHERE...RETURNING claims the slot.
  // Concurrent requests cannot race past the gate because postgres serializes the row update.
  const cutoff = new Date(Date.now() - FETCH_RATE_LIMIT_MS);
  const claimed = await db.update(posIntegrationsTable)
    .set({ lastManualFetchAt: new Date() })
    .where(and(
      eq(posIntegrationsTable.id, integration.id),
      sql`(${posIntegrationsTable.lastManualFetchAt} IS NULL OR ${posIntegrationsTable.lastManualFetchAt} < ${cutoff})`,
    ))
    .returning({ id: posIntegrationsTable.id });
  if (claimed.length === 0) {
    const elapsed = integration.lastManualFetchAt ? Date.now() - integration.lastManualFetchAt.getTime() : 0;
    const waitS = Math.max(1, Math.ceil((FETCH_RATE_LIMIT_MS - elapsed) / 1000));
    res.status(429).json({ error: `Please wait ${waitS}s before triggering another fetch on this integration` });
    return;
  }

  const userLabel = (req as any).user?.username || (req as any).user?.email || "admin";
  const results: Record<string, { status: string; count: number; errorCount: number; message: string }> = {};

  // De-dupe data types so we don't fetch sales twice
  const uniqueTypes = Array.from(new Set(dataTypes)) as PosDataType[];

  // Cache fetched orders so customers/bills don't re-fetch the same window
  let cachedOrders: any[] | null = null;
  async function getOrders(): Promise<any[]> {
    if (cachedOrders) return cachedOrders;
    const r = await fetchFromPos(integration, "sales", { from, to });
    cachedOrders = r.records;
    return cachedOrders;
  }

  for (const dataType of uniqueTypes) {
    const startedAt = Date.now();
    let status = "failed";
    let recordCount = 0;
    let errorCount = 0;
    let message = "";

    try {
      if (dataType === "sales" || dataType === "bills") {
        const orders = await getOrders();
        let created = 0;
        let skipped = 0;
        for (const raw of orders) {
          const ppOrder = raw.Order || raw.order || raw;
          const ppItems = raw.OrderItem || raw.OrderItems || raw.items || raw.order_items || [];
          const ppCustomer = raw.Customer || raw.customer || null;
          if (!ppOrder || !Array.isArray(ppItems) || ppItems.length === 0) { errorCount++; continue; }
          try {
            const r = await importPetpoojaOrder({ ppOrder, ppItems, ppCustomer, integration });
            if (r.created) created++; else skipped++;
          } catch (e: any) {
            errorCount++;
          }
        }
        recordCount = created;
        status = errorCount === 0 ? "success" : (created > 0 ? "partial" : "failed");
        message = `${created} ${dataType === "bills" ? "bills" : "orders"} imported, ${skipped} already existed${errorCount ? `, ${errorCount} errors` : ""} (out of ${orders.length} fetched)`;
      } else if (dataType === "customers") {
        const orders = await getOrders();
        let created = 0;
        let updated = 0;
        for (const raw of orders) {
          const c = raw.Customer || raw.customer || null;
          if (!c) continue;
          try {
            const r = await upsertPetpoojaCustomer({ name: c.name, phone: c.phone, email: c.email });
            if (r === "created") created++;
            else if (r === "updated") updated++;
          } catch {
            errorCount++;
          }
        }
        recordCount = created + updated;
        status = errorCount === 0 ? "success" : (recordCount > 0 ? "partial" : "failed");
        message = `${created} customers created, ${updated} updated${errorCount ? `, ${errorCount} errors` : ""}`;
      } else {
        // vendors / purchases / menu_items — provider says not_supported, this throws PosFetchError
        await fetchFromPos(integration, dataType, { from, to });
        status = "failed";
        message = `${dataType} not supported`;
      }
    } catch (e: any) {
      if (e instanceof PosFetchError) {
        status = e.code === "unsupported" || e.code === "webhook_only" ? "skipped" : "failed";
        message = e.message;
      } else {
        status = "failed";
        message = e?.message || "Unknown error";
      }
    }

    const durationMs = Date.now() - startedAt;
    await db.insert(posSyncLogsTable).values({
      integrationId: integration.id,
      dataType,
      status,
      recordCount,
      errorCount,
      fromDate: from,
      toDate: to,
      message: message.slice(0, 1000),
      triggeredBy: userLabel,
      durationMs,
    });

    results[dataType] = { status, count: recordCount, errorCount, message };
  }

  res.json({ results });
});

export default router;

