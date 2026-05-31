import https from "node:https";

import {
  db,
  posIntegrationsTable,
  posRecoveryLogsTable,
  posWebhookRoutesTable,
  saasSubscriptionLinkTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";

import { importPetpoojaOrder } from "./petpoojaImporter";
import { logger } from "./logger";
import { assertSafeProviderUrl, type PosIntegration, PosFetchError } from "./posProviders";
import { runWithTenantSchema } from "./saas";

const PETPOOJA_ALLOWED_HOST_SUFFIXES = ["petpooja.com", "petpooja.in"];
const PETPOOJA_RECOVERY_PATH = "/V1/thirdparty/generic_get_orders/";
const DEFAULT_RECOVERY_TIMEZONE = process.env.PETPOOJA_RECOVERY_TIMEZONE?.trim() || "Asia/Kolkata";
const DEFAULT_RECOVERY_HOUR = Number(process.env.PETPOOJA_RECOVERY_HOUR || "2");
const RECOVERY_LOOKBACK_DAYS = 3;
const RECOVERY_TIMEOUT_MS = 20_000;

export type RecoveryFailure = {
  orderRef: string;
  message: string;
};

export type RecoverySummary = {
  success: boolean;
  businessDate: string;
  petpoojaRequestDate: string;
  fetched: number;
  imported: number;
  skipped: number;
  failed: number;
  failures: RecoveryFailure[];
};

type RecoveryLogStatus = "success" | "partial" | "failed" | "no_records";
type RecoveryTriggerSource = "manual" | "scheduler";

type RecoveryOrderBundle = {
  ppOrder: Record<string, unknown>;
  ppItems: Array<Record<string, unknown>>;
  ppCustomer: Record<string, unknown> | null;
  orderRef: string;
};

type RecoveryResponse = {
  orders: RecoveryOrderBundle[];
  requestDate: string;
  message: string;
  rawCount: number;
};

type RecoveryRunContext = {
  schemaName: string | null;
  integration: PosIntegration;
  triggerSource: RecoveryTriggerSource;
  runDate: string;
};

function normalizeTenantSchemaName(value: string | null | undefined): string | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(normalized)) return null;
  if (normalized === "public" || normalized.startsWith("pg_") || normalized === "information_schema") return null;
  return normalized;
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return `${map.get("year")}-${map.get("month")}-${map.get("day")}`;
}

function formatClockInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return {
    isoDate: `${map.get("year")}-${map.get("month")}-${map.get("day")}`,
    hour: Number(map.get("hour") || "0"),
    minute: Number(map.get("minute") || "0"),
  };
}

function shiftIsoDate(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildLastBusinessDates(now: Date, timeZone: string, count = RECOVERY_LOOKBACK_DAYS): string[] {
  const today = formatDateInTimeZone(now, timeZone);
  return Array.from({ length: count }, (_, index) => shiftIsoDate(today, -(index + 1)));
}

function sanitizePartPayments(partPayments: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(partPayments) || partPayments.length === 0) return undefined;
  return partPayments.map((entry) => ({
    payment_type: entry && typeof entry === "object" ? (entry as any).payment_type || (entry as any).custome_payment_type || "Other" : "Other",
    custome_payment_type: entry && typeof entry === "object" ? (entry as any).custome_payment_type || null : null,
    amount: Number((entry as any)?.amount || 0),
  }));
}

function normalizeAddon(addon: any): Record<string, unknown> {
  return {
    name: addon?.name || addon?.addon_name || "",
    price: Number(addon?.price || addon?.amount || 0),
    quantity: Number(addon?.quantity || 1),
  };
}

function normalizeRecoveryOrder(raw: any): RecoveryOrderBundle {
  const order = raw?.Order || raw?.order || raw || {};
  const customer = raw?.Customer || raw?.customer || null;
  const items = Array.isArray(raw?.OrderItem)
    ? raw.OrderItem
    : Array.isArray(raw?.order_items)
      ? raw.order_items
      : [];

  const orderRef = String(order.customer_invoice_id || order.orderID || order.order_id || order.refId || "").trim();
  const ppOrder = {
    ...order,
    customer_invoice_id: order.customer_invoice_id || order.invoice_no || order.customerInvoiceId || null,
    orderID: order.orderID || order.order_id || order.orderId || null,
    order_id: order.order_id || order.orderID || order.orderId || null,
    created_on: order.created_on || order.createdOn || order.order_date || order.business_date || "",
    order_type: order.order_type || order.orderType || "",
    payment_type: order.payment_type || order.paymentType || "cash",
    part_payments: sanitizePartPayments(order.part_payments || order.part_payment),
    packaging_charge: Number(order.packaging_charge ?? order.container_charges ?? order.container_charge ?? 0),
    delivery_charges: Number(order.delivery_charges || order.delivery_charge || 0),
    discount_total: Number(order.discount_total ?? order.total_discount ?? 0),
    tax_total: Number(order.tax_total ?? order.total_tax ?? 0),
    total: Number(order.total || order.final_total || 0),
  };

  const ppItems = items.map((item: any) => ({
    ...item,
    category_name: item.category_name || item.categoryname || item.category || "",
    name: item.name || item.item_name || item.itemName || "",
    quantity: Number(item.quantity || 1),
    price: Number(item.price || item.rate || 0),
    total: Number(item.total || item.amount || item.line_total || 0),
    discount: Number(item.discount ?? item.total_discount ?? 0),
    tax: Number(item.tax ?? item.total_tax ?? 0),
    addon: Array.isArray(item.addon) ? item.addon.map(normalizeAddon) : [],
  }));

  return {
    ppOrder,
    ppItems,
    ppCustomer: customer && typeof customer === "object" ? customer : null,
    orderRef,
  };
}

function parseRecoveryPayload(payload: any, businessDate: string): RecoveryResponse {
  const requestDate = shiftIsoDate(businessDate, 1);
  const records = Array.isArray(payload?.order_json)
    ? payload.order_json
    : Array.isArray(payload?.data?.order_json)
      ? payload.data.order_json
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload)
          ? payload
          : [];
  const message = String(
    payload?.message ||
    payload?.msg ||
    payload?.status_message ||
    payload?.statusMessage ||
    "",
  ).trim();

  if (records.length === 0) {
    if (/no records found/i.test(message)) {
      return { orders: [], requestDate, message: "No Records Found", rawCount: 0 };
    }
    return { orders: [], requestDate, message: message || "No records returned", rawCount: 0 };
  }

  return {
    orders: records.map(normalizeRecoveryOrder),
    requestDate,
    message: message || `${records.length} orders returned`,
    rawCount: records.length,
  };
}

async function requestPetpoojaRecoveryOrders(integration: PosIntegration, businessDate: string): Promise<RecoveryResponse> {
  if (!integration.apiKey || !integration.apiSecret || !integration.accessToken || !integration.restaurantId) {
    throw new PosFetchError("config", "Petpooja recovery requires apiKey, apiSecret, accessToken, and restaurantId in POS integration settings.");
  }

  const rawBase = (integration.baseUrl || "https://api.petpooja.com").replace(/\/+$/, "");
  const baseUrl = assertSafeProviderUrl(rawBase, PETPOOJA_ALLOWED_HOST_SUFFIXES);
  const requestDate = shiftIsoDate(businessDate, 1);
  const requestBody = JSON.stringify({
    app_key: integration.apiKey,
    app_secret: integration.apiSecret,
    access_token: integration.accessToken,
    restID: integration.restaurantId,
    order_date: requestDate,
    refId: "",
  });

  const payload = await new Promise<any>((resolve, reject) => {
    const req = https.request({
      protocol: baseUrl.protocol,
      hostname: baseUrl.hostname,
      port: baseUrl.port ? Number(baseUrl.port) : 443,
      path: PETPOOJA_RECOVERY_PATH,
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestBody),
      },
      timeout: RECOVERY_TIMEOUT_MS,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let body: any = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = text;
        }
        if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
          reject(new PosFetchError(
            res.statusCode === 401 || res.statusCode === 403 ? "auth" : "http",
            `Petpooja recovery API responded ${res.statusCode}: ${typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200)}`,
          ));
          return;
        }
        resolve(body);
      });
    });

    req.on("timeout", () => {
      req.destroy(new PosFetchError("timeout", `Petpooja recovery API timed out after ${RECOVERY_TIMEOUT_MS / 1000}s`));
    });
    req.on("error", (error) => {
      if (error instanceof PosFetchError) {
        reject(error);
        return;
      }
      reject(new PosFetchError("network", `Petpooja recovery API unreachable: ${error.message}`));
    });

    req.write(requestBody);
    req.end();
  });

  return parseRecoveryPayload(payload, businessDate);
}

function resolveRecoveryStatus(imported: number, skipped: number, failed: number, fetched: number): RecoveryLogStatus {
  if (fetched === 0) return "no_records";
  if (failed === 0) return "success";
  if (imported > 0 || skipped > 0) return "partial";
  return "failed";
}

async function saveRecoveryLog(input: {
  integration: PosIntegration;
  triggerSource: RecoveryTriggerSource;
  runDate: string;
  businessDate: string;
  petpoojaRequestDate: string;
  fetched: number;
  imported: number;
  skipped: number;
  failed: number;
  failures: RecoveryFailure[];
  durationMs: number;
  message: string;
}) {
  const status = resolveRecoveryStatus(input.imported, input.skipped, input.failed, input.fetched);
  await db.insert(posRecoveryLogsTable).values({
    integrationId: input.integration.id,
    provider: input.integration.provider,
    triggerSource: input.triggerSource,
    runDate: input.runDate,
    businessDate: input.businessDate,
    providerRequestDate: input.petpoojaRequestDate,
    status,
    fetchedCount: input.fetched,
    importedCount: input.imported,
    skippedCount: input.skipped,
    failedCount: input.failed,
    message: input.message.slice(0, 1000),
    failures: input.failures.length > 0 ? input.failures : null,
    durationMs: input.durationMs,
  });
}

function buildRecoveryMessage(summary: RecoverySummary): string {
  if (summary.failed > 0 && summary.fetched === 0) {
    return summary.failures[0]?.message || "Petpooja recovery failed";
  }
  if (summary.fetched === 0) return "No Records Found";
  return `${summary.imported} imported, ${summary.skipped} skipped, ${summary.failed} failed (out of ${summary.fetched} fetched)`;
}

export async function recoverPetpoojaSalesForBusinessDate(input: RecoveryRunContext & { businessDate: string }): Promise<RecoverySummary> {
  const startedAt = Date.now();
  const integration = {
    ...input.integration,
    tenantSchemaName: normalizeTenantSchemaName(input.schemaName || input.integration.tenantSchemaName),
  } satisfies PosIntegration;
  let response: RecoveryResponse | null = null;
  const failures: RecoveryFailure[] = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  try {
    response = await requestPetpoojaRecoveryOrders(integration, input.businessDate);

    for (const order of response.orders) {
      if (!order.ppOrder || !Array.isArray(order.ppItems) || order.ppItems.length === 0) {
        failed += 1;
        failures.push({ orderRef: order.orderRef || "unknown", message: "Missing OrderItem in recovery payload" });
        continue;
      }

      try {
        const result = await importPetpoojaOrder({
          ppOrder: order.ppOrder,
          ppItems: order.ppItems,
          ppCustomer: order.ppCustomer || undefined,
          integration,
        });
        if (result.created) imported += 1;
        else skipped += 1;
      } catch (error: any) {
        failed += 1;
        failures.push({
          orderRef: order.orderRef || String(order.ppOrder.customer_invoice_id || order.ppOrder.orderID || order.ppOrder.order_id || "unknown"),
          message: error?.message || "Unknown import error",
        });
      }
    }
  } catch (error: any) {
    failed += 1;
    failures.push({
      orderRef: "request",
      message: error?.message || "Petpooja recovery request failed",
    });
  }

  const summary: RecoverySummary = {
    success: failed === 0,
    businessDate: input.businessDate,
    petpoojaRequestDate: response?.requestDate || shiftIsoDate(input.businessDate, 1),
    fetched: response?.rawCount || 0,
    imported,
    skipped,
    failed,
    failures,
  };

  await saveRecoveryLog({
    integration,
    triggerSource: input.triggerSource,
    runDate: input.runDate,
    businessDate: input.businessDate,
    petpoojaRequestDate: summary.petpoojaRequestDate,
    fetched: summary.fetched,
    imported: summary.imported,
    skipped: summary.skipped,
    failed: summary.failed,
    failures: summary.failures,
    durationMs: Date.now() - startedAt,
    message: response?.message || buildRecoveryMessage(summary),
  });

  await db.update(posIntegrationsTable).set({
    lastSyncAt: new Date(),
    lastSyncStatus: summary.failed > 0 ? (summary.imported > 0 || summary.skipped > 0 ? "partial" : "failed") : "success",
    lastSyncMessage: buildRecoveryMessage(summary),
  }).where(eq(posIntegrationsTable.id, integration.id));

  if (failures.some((failure) => failure.orderRef === "request")) {
    throw new Error(failures[0]?.message || "Petpooja recovery request failed");
  }

  return summary;
}

function isRecoveryConfigured(integration: PosIntegration): boolean {
  return Boolean(
    integration.active &&
    integration.provider === "petpooja" &&
    integration.syncOrders &&
    integration.apiKey &&
    integration.apiSecret &&
    integration.accessToken &&
    integration.restaurantId,
  );
}

async function listDistinctTenantSchemas(): Promise<string[]> {
  const [routeRows, saasRows] = await Promise.all([
    db.select({ tenantSchemaName: posWebhookRoutesTable.tenantSchemaName })
      .from(posWebhookRoutesTable)
      .where(and(eq(posWebhookRoutesTable.provider, "petpooja"), eq(posWebhookRoutesTable.active, true))),
    db.select({ tenantSchemaName: saasSubscriptionLinkTable.tenantSchemaName })
      .from(saasSubscriptionLinkTable)
      .orderBy(desc(saasSubscriptionLinkTable.updatedAt)),
  ]);

  const names = new Set<string>();
  for (const row of [...routeRows, ...saasRows]) {
    const normalized = normalizeTenantSchemaName(row.tenantSchemaName);
    if (normalized) names.add(normalized);
  }
  return Array.from(names);
}

async function listPetpoojaRecoveryTargets(): Promise<Array<{ schemaName: string | null; integration: PosIntegration }>> {
  const publicIntegrations = await db.select().from(posIntegrationsTable)
    .where(and(
      eq(posIntegrationsTable.provider, "petpooja"),
      eq(posIntegrationsTable.active, true),
      eq(posIntegrationsTable.syncOrders, true),
    ));

  const tenantSchemas = await listDistinctTenantSchemas();
  const tenantIntegrations: Array<{ schemaName: string; integration: PosIntegration }> = [];

  for (const schemaName of tenantSchemas) {
    const rows = await runWithTenantSchema(schemaName, async () => (
      await db.select().from(posIntegrationsTable)
        .where(and(
          eq(posIntegrationsTable.provider, "petpooja"),
          eq(posIntegrationsTable.active, true),
          eq(posIntegrationsTable.syncOrders, true),
        ))
    ));
    for (const integration of rows) {
      tenantIntegrations.push({
        schemaName,
        integration: { ...integration, tenantSchemaName: schemaName },
      });
    }
  }

  return [
    ...publicIntegrations.map((integration) => ({ schemaName: null, integration })),
    ...tenantIntegrations,
  ].filter(({ integration }) => isRecoveryConfigured(integration));
}

async function runRecoveryForTarget(target: { schemaName: string | null; integration: PosIntegration }, businessDate: string, triggerSource: RecoveryTriggerSource, runDate: string) {
  return runWithTenantSchema(target.schemaName, async () => (
    await recoverPetpoojaSalesForBusinessDate({
      schemaName: target.schemaName,
      integration: target.integration,
      businessDate,
      triggerSource,
      runDate,
    })
  ));
}

let schedulerStarted = false;
let schedulerTimer: NodeJS.Timeout | null = null;
let lastSchedulerRunDate: string | null = null;

export function startPetpoojaRecoveryScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = async () => {
    const now = new Date();
    const clock = formatClockInTimeZone(now, DEFAULT_RECOVERY_TIMEZONE);
    if (clock.hour < DEFAULT_RECOVERY_HOUR) return;
    if (lastSchedulerRunDate === clock.isoDate) return;

    lastSchedulerRunDate = clock.isoDate;
    const businessDates = buildLastBusinessDates(now, DEFAULT_RECOVERY_TIMEZONE, RECOVERY_LOOKBACK_DAYS);

    try {
      const targets = await listPetpoojaRecoveryTargets();
      if (targets.length === 0) {
        logger.info({ runDate: clock.isoDate }, "petpooja recovery scheduler: no configured integrations");
        return;
      }

      logger.info({
        runDate: clock.isoDate,
        targetCount: targets.length,
        businessDates,
      }, "petpooja recovery scheduler: starting");

      for (const target of targets) {
        for (const businessDate of businessDates) {
          try {
            const summary = await runRecoveryForTarget(target, businessDate, "scheduler", clock.isoDate);
            logger.info({
              integrationId: target.integration.id,
              tenantSchemaName: target.schemaName || "public",
              businessDate,
              fetched: summary.fetched,
              imported: summary.imported,
              skipped: summary.skipped,
              failed: summary.failed,
            }, "petpooja recovery scheduler: recovery completed");
          } catch (error: any) {
            logger.error({
              err: error,
              integrationId: target.integration.id,
              tenantSchemaName: target.schemaName || "public",
              businessDate,
            }, "petpooja recovery scheduler: recovery failed");
          }
        }
      }
    } catch (error: any) {
      lastSchedulerRunDate = null;
      logger.error({ err: error }, "petpooja recovery scheduler tick failed");
    }
  };

  setTimeout(() => {
    void tick();
    schedulerTimer = setInterval(() => void tick(), 60_000);
  }, 45_000);
  logger.info({
    timeZone: DEFAULT_RECOVERY_TIMEZONE,
    recoveryHour: DEFAULT_RECOVERY_HOUR,
    lookbackDays: RECOVERY_LOOKBACK_DAYS,
  }, "petpooja recovery scheduler started");
}

export function stopPetpoojaRecoveryScheduler() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  schedulerStarted = false;
  lastSchedulerRunDate = null;
}

export async function runManualPetpoojaRecovery(integration: PosIntegration, schemaName: string | null, businessDate: string): Promise<RecoverySummary> {
  const runDate = formatDateInTimeZone(new Date(), DEFAULT_RECOVERY_TIMEZONE);
  return runRecoveryForTarget({
    schemaName,
    integration: { ...integration, tenantSchemaName: normalizeTenantSchemaName(schemaName || integration.tenantSchemaName) },
  }, businessDate, "manual", runDate);
}
