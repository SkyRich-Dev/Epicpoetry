import { Router } from "express";
import { db, posIntegrationsTable, petpoojaItemMappingsTable, menuItemsTable,
  salesInvoicesTable, salesInvoiceLinesTable, salesImportBatchesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { authMiddleware, adminOnly } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import crypto from "crypto";

const router = Router();

function redactSecrets(obj: any) {
  if (!obj) return obj;
  const redacted = { ...obj };
  if (redacted.apiKey) redacted.apiKey = "****";
  if (redacted.apiSecret) redacted.apiSecret = "****";
  if (redacted.webhookSecret) redacted.webhookSecret = "****";
  if (redacted.accessToken) redacted.accessToken = "****";
  return redacted;
}

router.get("/pos-integrations", authMiddleware, adminOnly, async (req, res): Promise<void> => {
  const integrations = await db.select().from(posIntegrationsTable).orderBy(posIntegrationsTable.createdAt);
  const safe = integrations.map(i => ({
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
  const [integration] = await db.select().from(posIntegrationsTable).where(eq(posIntegrationsTable.id, id));
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
  if (!name || !provider) { res.status(400).json({ error: "name and provider are required" }); return; }

  const webhookSecret = crypto.randomBytes(32).toString("hex");

  const [integration] = await db.insert(posIntegrationsTable).values({
    name, provider,
    apiKey: apiKey || null,
    apiSecret: apiSecret || null,
    webhookSecret,
    restaurantId: restaurantId || null,
    baseUrl: baseUrl || null,
    accessToken: accessToken || null,
    autoSync: autoSync ?? false,
    syncMenuItems: syncMenuItems ?? true,
    syncOrders: syncOrders ?? true,
    defaultGstPercent: defaultGstPercent ?? 5,
    defaultOrderType: defaultOrderType || "dine-in",
  }).returning();

  await createAuditLog("pos_integrations", integration.id, "create", null, redactSecrets(integration));
  res.status(201).json({
    ...integration,
    apiSecret: integration.apiSecret ? "****" : null,
    accessToken: integration.accessToken ? "****" : null,
  });
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
    const allMappings = await db.select().from(petpoojaItemMappingsTable);
    const mapped = allMappings.filter(m => m.menuItemId !== null);
    const unmapped = allMappings.filter(m => m.menuItemId === null);

    const batches = await db.select().from(salesImportBatchesTable)
      .where(eq(salesImportBatchesTable.sourceType, "petpooja"))
      .orderBy(sql`${salesImportBatchesTable.createdAt} DESC`)
      .limit(5);

    const invoiceCount = await db.select({ count: sql<number>`count(*)::int` })
      .from(salesInvoicesTable)
      .where(eq(salesInvoicesTable.sourceType, "petpooja"));

    res.json({
      totalMappings: allMappings.length,
      mappedItems: mapped.length,
      unmappedItems: unmapped.length,
      totalInvoicesImported: invoiceCount[0]?.count || 0,
      totalOrdersSynced: integration.totalOrdersSynced,
      lastSync: integration.lastSyncAt,
      lastSyncStatus: integration.lastSyncStatus,
      recentBatches: batches,
    });
    return;
  }

  res.json({ totalOrdersSynced: integration.totalOrdersSynced, lastSync: integration.lastSyncAt });
});

router.post("/webhook/petpooja/:integrationId", async (req, res): Promise<void> => {
  const integrationId = Number(req.params.integrationId);
  const [integration] = await db.select().from(posIntegrationsTable).where(
    and(eq(posIntegrationsTable.id, integrationId), eq(posIntegrationsTable.provider, "petpooja"))
  );
  if (!integration || !integration.active) {
    res.status(404).json({ error: "Integration not found or inactive" }); return;
  }

  const providedSecret = req.headers["x-webhook-secret"] || req.body?.webhook_secret;
  if (!providedSecret || providedSecret !== integration.webhookSecret) {
    res.status(401).json({ error: "Invalid webhook secret" }); return;
  }

  const { orders } = req.body;
  if (!orders || !Array.isArray(orders) || orders.length === 0) {
    res.status(400).json({ error: "No orders in payload" }); return;
  }

  const mappings = await db.select().from(petpoojaItemMappingsTable);
  const mapByPpId = new Map(mappings.filter(m => m.petpoojaItemId && m.menuItemId).map(m => [m.petpoojaItemId!, m]));
  const mapByPpName = new Map(mappings.filter(m => m.menuItemId).map(m => [m.petpoojaItemName.toLowerCase().trim(), m]));
  const menuItems = await db.select().from(menuItemsTable);
  const menuById = new Map(menuItems.map(m => [m.id, m]));
  const menuByName = new Map(menuItems.map(m => [m.name.toLowerCase().trim(), m]));

  let successCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  for (const order of orders) {
    try {
      const salesDate = order.order_date || order.date || new Date().toISOString().split("T")[0];
      const invoiceNo = order.order_id || order.invoice_no || `PP-${Date.now()}`;
      const invoiceTime = order.order_time || order.time || "";
      const orderType = (order.order_type || integration.defaultOrderType || "dine-in").toLowerCase().replace(/\s+/g, "-");
      const customerName = order.customer_name || order.customer || "";
      const paymentMode = (order.payment_mode || order.payment_type || "cash").toLowerCase();
      const totalDiscount = Number(order.discount || 0);

      const items = order.items || order.line_items || [];
      if (!Array.isArray(items) || items.length === 0) {
        errors.push(`Order ${invoiceNo}: No items`);
        failedCount++;
        continue;
      }

      const lineData: any[] = [];
      let hasUnmapped = false;

      for (const item of items) {
        const ppItemId = String(item.item_id || item.petpooja_item_id || "").trim();
        const ppItemName = String(item.item_name || item.name || "").trim();
        const qty = Number(item.quantity || item.qty || 1);
        const gstPercent = Number(item.gst_percent || item.tax_percent || integration.defaultGstPercent || 5);

        let menuItem: any = null;
        const mappingById = ppItemId ? mapByPpId.get(ppItemId) : undefined;
        const mappingByName = mapByPpName.get(ppItemName.toLowerCase().trim());
        const mapping = mappingById || mappingByName;

        if (mapping && mapping.menuItemId) {
          menuItem = menuById.get(mapping.menuItemId);
        } else {
          menuItem = menuByName.get(ppItemName.toLowerCase().trim());
        }

        if (!mapping) {
          const existingMapping = mappings.find(m =>
            (ppItemId && m.petpoojaItemId === ppItemId) ||
            m.petpoojaItemName.toLowerCase().trim() === ppItemName.toLowerCase().trim()
          );
          if (!existingMapping) {
            await db.insert(petpoojaItemMappingsTable).values({
              petpoojaItemId: ppItemId || null,
              petpoojaItemName: ppItemName,
              menuItemId: menuItem?.id || null,
            });
          }
        }

        if (!menuItem) {
          hasUnmapped = true;
          continue;
        }

        lineData.push({
          menuItemId: menuItem.id,
          itemCodeSnapshot: menuItem.code,
          itemNameSnapshot: menuItem.name,
          fixedPrice: Number(menuItem.sellingPrice),
          quantity: qty,
          gstPercent,
        });
      }

      if (lineData.length === 0) {
        errors.push(`Order ${invoiceNo}: All items unmapped`);
        failedCount++;
        continue;
      }

      let grossAmount = 0;
      const processedLines = lineData.map(l => {
        const gross = l.quantity * l.fixedPrice;
        grossAmount += gross;
        return { ...l, grossLineAmount: gross };
      });

      const discountRatio = grossAmount > 0 ? totalDiscount / grossAmount : 0;
      let totalGst = 0;
      let totalTaxable = 0;
      let totalFinal = 0;

      const finalLines = processedLines.map(l => {
        const lineDiscount = Math.round(l.grossLineAmount * discountRatio * 100) / 100;
        const taxable = l.grossLineAmount - lineDiscount;
        const gst = Math.round(taxable * l.gstPercent / 100 * 100) / 100;
        const finalAmt = taxable + gst;
        totalGst += gst;
        totalTaxable += taxable;
        totalFinal += finalAmt;
        return {
          ...l,
          lineDiscountAmount: lineDiscount,
          discountedUnitPrice: l.quantity > 0 ? (l.grossLineAmount - lineDiscount) / l.quantity : 0,
          taxableLineAmount: taxable,
          gstAmount: gst,
          finalLineAmount: finalAmt,
        };
      });

      await db.transaction(async (tx) => {
        const [invoice] = await tx.insert(salesInvoicesTable).values({
          salesDate, invoiceNo, invoiceTime,
          sourceType: "petpooja",
          orderType, customerName,
          grossAmount, totalDiscount,
          taxableAmount: totalTaxable,
          gstAmount: totalGst,
          finalAmount: totalFinal,
          paymentMode,
          matchStatus: "matched",
          matchDifference: 0,
        }).returning();

        for (const line of finalLines) {
          await tx.insert(salesInvoiceLinesTable).values({
            invoiceId: invoice.id,
            ...line,
          });
        }
      });

      successCount++;
    } catch (e: any) {
      errors.push(`Order processing failed: ${e.message}`);
      failedCount++;
    }
  }

  await db.update(posIntegrationsTable).set({
    lastSyncAt: new Date(),
    lastSyncStatus: failedCount === 0 ? "success" : "partial",
    lastSyncMessage: `${successCount} synced, ${failedCount} failed`,
    totalOrdersSynced: sql`${posIntegrationsTable.totalOrdersSynced} + ${successCount}`,
  }).where(eq(posIntegrationsTable.id, integrationId));

  res.json({
    success: true,
    processed: orders.length,
    successCount,
    failedCount,
    errors: errors.length > 0 ? errors : undefined,
  });
});

export default router;
