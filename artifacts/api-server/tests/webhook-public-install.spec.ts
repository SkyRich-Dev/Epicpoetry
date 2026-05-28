import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

type IntegrationRecord = {
  id: number;
  provider: string;
  webhookSecret: string;
  publicWebhookKey: string;
  webhookIdentifier: string | null;
  legacyWebhookId: string | null;
  isLegacyActive: boolean;
  tenantSchemaName: string | null;
  restaurantId: string | null;
};

const TEST_API_PORT = 3116;
const TEST_INVOICE_A = "PP-ORDER_PUBLIC_001";
const TEST_INVOICE_B = "PP-ORDER_PUBLIC_002";
const TEST_INVOICE_LEGACY = "PP-ORDER_PUBLIC_LEGACY";
const TEST_INVOICE_CUSTOM = "PP-ORDER_PUBLIC_CUSTOM";
const TEST_RESTAURANT = "REST_PUBLIC";
const TEST_RESTAURANT_DUP = "REST_PUBLIC_DUP";
const execFileAsync = promisify(execFile);

let apiProcess: ChildProcess | null = null;
let baseUrl = "";
let integration: IntegrationRecord;
const testLogs: Array<Record<string, unknown>> = [];

function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), "../../.env");
  const text = readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1);
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function httpJson(pathname: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return { response, body };
}

function ownerTokenWithoutTenant() {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({
    userId: 1,
    role: "owner",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString("base64url");
  const signature = crypto
    .createHmac("sha256", process.env.SESSION_SECRET || "")
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

async function runSql(sql: string) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
  await execFileAsync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-c", sql], { maxBuffer: 1024 * 1024 * 5 });
}

async function queryJson<T>(sql: string): Promise<T> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
  const wrapped = `select coalesce(json_agg(t), '[]'::json)::text from (${sql}) t;`;
  const { stdout } = await execFileAsync("psql", [databaseUrl, "-At", "-v", "ON_ERROR_STOP=1", "-c", wrapped], {
    maxBuffer: 1024 * 1024 * 5,
  });
  return JSON.parse(stdout.trim() || "[]") as T;
}

async function waitForHealth(url: string, timeoutMs = 15000) {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${url}/api/healthz`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Local API did not become healthy in time: ${String(lastError || "timeout")}`);
}

async function ensurePublicPosIntegrationColumns() {
  await runSql(`
    ALTER TABLE public.pos_integrations
      ADD COLUMN IF NOT EXISTS public_webhook_key text,
      ADD COLUMN IF NOT EXISTS tenant_schema_name text;
  `);
  await runSql(`
    CREATE UNIQUE INDEX IF NOT EXISTS pos_integrations_public_webhook_key_idx
    ON public.pos_integrations (public_webhook_key);
  `);
  await runSql(`
    CREATE INDEX IF NOT EXISTS pos_integrations_tenant_schema_name_idx
    ON public.pos_integrations (tenant_schema_name);
  `);
}

async function cleanupPublicArtifacts() {
  await runSql(`
    DELETE FROM public.sales_invoice_lines
    WHERE invoice_id IN (
      SELECT id FROM public.sales_invoices
      WHERE invoice_no IN ('${TEST_INVOICE_A}', '${TEST_INVOICE_B}', '${TEST_INVOICE_LEGACY}', '${TEST_INVOICE_CUSTOM}')
    );
  `);
  await runSql(`
    DELETE FROM public.sales_invoices
    WHERE invoice_no IN ('${TEST_INVOICE_A}', '${TEST_INVOICE_B}', '${TEST_INVOICE_LEGACY}', '${TEST_INVOICE_CUSTOM}');
  `);
  await runSql(`
    DELETE FROM public.pos_webhook_events
    WHERE integration_id IN (
      SELECT id FROM public.pos_integrations
      WHERE restaurant_id IN ('${TEST_RESTAURANT}', '${TEST_RESTAURANT_DUP}')
    );
  `);
  await runSql(`
    DELETE FROM public.pos_sync_logs
    WHERE integration_id IN (
      SELECT id FROM public.pos_integrations
      WHERE restaurant_id IN ('${TEST_RESTAURANT}', '${TEST_RESTAURANT_DUP}')
    );
  `);
  await runSql(`
    DELETE FROM public.pos_integrations
    WHERE restaurant_id IN ('${TEST_RESTAURANT}', '${TEST_RESTAURANT_DUP}');
  `);
  await runSql(`
    DELETE FROM public.pos_webhook_routes
    WHERE tenant_schema_name IS NULL
      AND integration_id NOT IN (SELECT id FROM public.pos_integrations);
  `);
}

async function createIntegration(name = "Petpooja Public Install", restaurantId = TEST_RESTAURANT, webhookIdentifier?: string) {
  const payload = {
    name,
    provider: "petpooja",
    restaurantId,
    accessToken: "User@123",
    defaultGstPercent: 5,
    defaultOrderType: "dine-in",
    active: true,
    syncOrders: true,
    syncMenuItems: true,
    autoSync: false,
    webhookIdentifier: webhookIdentifier || "",
  };

  const { response, body } = await httpJson("/api/pos-integrations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ownerTokenWithoutTenant()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  testLogs.push({
    step: "createPublicIntegration",
    responseStatus: response.status,
    responseBody: body,
  });

  assert.equal(response.status, 201, `Failed to create public integration: ${JSON.stringify(body)}`);
  assert.equal(body.provider, "petpooja");
  assert.equal(body.tenantSchemaName ?? null, null);
  assert.ok(body.publicWebhookKey, "Expected publicWebhookKey in create response");
  assert.ok(body.webhookSecret, "Expected webhookSecret in create response");
  assert.equal(body.legacyWebhookId, String(body.id));
  return body as IntegrationRecord;
}

function petpoojaPayload(orderId: string, restaurantId: string, itemName: string, qty: number) {
  return {
    event: "orderdetails",
    properties: {
      Order: {
        orderID: orderId.replace(/^PP-/, ""),
        customer_invoice_id: orderId.replace(/^PP-/, ""),
        created_on: "2026-05-27 10:00:00",
        total: qty * 100,
        order_type: "Dine In",
        payment_type: "cash",
        restaurant_id: restaurantId,
      },
      OrderItem: [
        {
          name: itemName,
          category_name: "Main",
          quantity: qty,
          price: 100,
          total: qty * 100,
        },
      ],
      Customer: {
        name: `${itemName} Customer`,
        phone: "9999999999",
      },
    },
  };
}

async function sendWebhook(identifier: string, payload: Record<string, unknown>) {
  const webhookPath = `/api/webhook/petpooja/${identifier}`;
  const { response, body } = await httpJson(webhookPath, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Secret": integration.webhookSecret,
    },
    body: JSON.stringify(payload),
  });

  testLogs.push({
    step: "sendPublicWebhook",
    webhookPath,
    responseStatus: response.status,
    responseBody: body,
  });
  return { response, body };
}

before(async () => {
  loadEnvFile();
  baseUrl = `http://127.0.0.1:${TEST_API_PORT}`;
  await ensurePublicPosIntegrationColumns();
  await cleanupPublicArtifacts();

  apiProcess = spawn("node", ["dist/index.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_PORT: String(TEST_API_PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  apiProcess.stdout?.on("data", (chunk) => {
    testLogs.push({ step: "api.stdout", line: chunk.toString().trim() });
  });
  apiProcess.stderr?.on("data", (chunk) => {
    testLogs.push({ step: "api.stderr", line: chunk.toString().trim() });
  });

  await waitForHealth(baseUrl);
  integration = await createIntegration();
});

after(async () => {
  if (apiProcess) {
    apiProcess.kill();
    apiProcess = null;
  }
  await cleanupPublicArtifacts();
});

test("existing tenant-safe webhook test still covers SaaS route assumptions", async () => {
  assert.ok(integration.publicWebhookKey, "Public integration key should exist");
  assert.equal(integration.tenantSchemaName ?? null, null);
  assert.equal(integration.legacyWebhookId, String(integration.id));
});

test("routes hash-based public webhook into public schema only", async () => {
  const payload = petpoojaPayload(TEST_INVOICE_A, TEST_RESTAURANT, "Direct Burger", 2);
  const result = await sendWebhook(integration.publicWebhookKey, payload);
  assert.equal(result.response.status, 200, JSON.stringify(result.body));

  const invoiceRows = await queryJson<Array<{ invoice_no: string; source_type: string }>>(
    `SELECT invoice_no, source_type FROM public.sales_invoices WHERE invoice_no = '${TEST_INVOICE_A}'`
  );
  assert.equal(invoiceRows.length, 1, "Expected invoice in public schema");
  assert.equal(invoiceRows[0]?.source_type, "petpooja");
});

test("routes legacy numeric webhook into public schema only", async () => {
  const payload = petpoojaPayload(TEST_INVOICE_LEGACY, TEST_RESTAURANT, "Legacy Burger", 1);
  const result = await sendWebhook(String(integration.legacyWebhookId), payload);
  assert.equal(result.response.status, 200, JSON.stringify(result.body));

  const invoiceRows = await queryJson<Array<{ invoice_no: string }>>(
    `SELECT invoice_no FROM public.sales_invoices WHERE invoice_no = '${TEST_INVOICE_LEGACY}'`
  );
  assert.equal(invoiceRows.length, 1, "Expected legacy webhook invoice in public schema");
});

test("routes custom slug webhook into public schema only", async () => {
  const patch = await httpJson(`/api/pos-integrations/${integration.id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${ownerTokenWithoutTenant()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ webhookIdentifier: "slvcoffee" }),
  });
  assert.equal(patch.response.status, 200, JSON.stringify(patch.body));
  integration = { ...(patch.body as IntegrationRecord), webhookSecret: integration.webhookSecret };

  const payload = petpoojaPayload(TEST_INVOICE_CUSTOM, TEST_RESTAURANT, "Custom Burger", 3);
  const result = await sendWebhook("slvcoffee", payload);
  assert.equal(result.response.status, 200, JSON.stringify(result.body));

  const invoiceRows = await queryJson<Array<{ invoice_no: string }>>(
    `SELECT invoice_no FROM public.sales_invoices WHERE invoice_no = '${TEST_INVOICE_CUSTOM}'`
  );
  assert.equal(invoiceRows.length, 1, "Expected custom webhook invoice in public schema");
});

test("rejects duplicate custom webhook identifiers", async () => {
  const duplicate = await createIntegration("Petpooja Public Duplicate", TEST_RESTAURANT_DUP);
  const patch = await httpJson(`/api/pos-integrations/${duplicate.id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${ownerTokenWithoutTenant()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ webhookIdentifier: "slvcoffee" }),
  });
  assert.equal(patch.response.status, 409);
  assert.equal(patch.body?.errorCode, "POS_INTEGRATION_IDENTIFIER_DUPLICATE");
});

test("returns 404 for invalid public webhook key", async () => {
  const { response, body } = await httpJson("/api/webhook/petpooja/invalid_public_key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(petpoojaPayload(TEST_INVOICE_B, TEST_RESTAURANT, "Invalid Burger", 1)),
  });
  assert.equal(response.status, 404);
  assert.deepEqual(body, { error: "Integration not found or inactive" });
});

test("prints verification summary for public install flow", async () => {
  console.log(JSON.stringify({
    publicWebhookUrl: `${baseUrl}/api/webhook/petpooja/${integration.publicWebhookKey}`,
    legacyWebhookUrl: `${baseUrl}/api/webhook/petpooja/${integration.legacyWebhookId}`,
    customWebhookUrl: integration.webhookIdentifier ? `${baseUrl}/api/webhook/petpooja/${integration.webhookIdentifier}` : null,
    integration,
    logs: testLogs,
  }, null, 2));
});
