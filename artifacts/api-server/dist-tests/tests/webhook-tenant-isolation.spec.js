import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
const TENANT_A = "tenant_a_schema";
const TENANT_B = "tenant_b_schema";
const TEST_SCHEMAS = [TENANT_A, TENANT_B];
const tenantRecords = [
    { schema: TENANT_A, customerId: 8001, email: "tenant.a@example.com", name: "Tenant A Owner", company: "Tenant A Cafe" },
    { schema: TENANT_B, customerId: 8002, email: "tenant.b@example.com", name: "Tenant B Owner", company: "Tenant B Cafe" },
];
let apiProcess = null;
let baseUrl = "";
let integrationA;
let integrationB;
const testLogs = [];
const execFileAsync = promisify(execFile);
const TEST_API_PORT = 3115;
function loadEnvFile() {
    const envPath = path.resolve(process.cwd(), "../../.env");
    const text = readFileSync(envPath, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#"))
            continue;
        const idx = line.indexOf("=");
        if (idx === -1)
            continue;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1);
        if (!(key in process.env)) {
            process.env[key] = value;
        }
    }
}
async function httpJson(pathname, init) {
    const response = await fetch(`${baseUrl}${pathname}`, init);
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    return { response, body };
}
function ownerToken(schema) {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({
        userId: 1,
        role: "owner",
        tenantSchemaName: schema,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString("base64url");
    const signature = crypto
        .createHmac("sha256", process.env.SESSION_SECRET || "")
        .update(`${header}.${body}`)
        .digest("base64url");
    return `${header}.${body}.${signature}`;
}
async function runSql(sql) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error("DATABASE_URL is not configured");
    }
    await execFileAsync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-c", sql], { maxBuffer: 1024 * 1024 * 5 });
}
async function queryJson(sql) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error("DATABASE_URL is not configured");
    }
    const wrapped = `select coalesce(json_agg(t), '[]'::json)::text from (${sql}) t;`;
    const { stdout } = await execFileAsync("psql", [databaseUrl, "-At", "-v", "ON_ERROR_STOP=1", "-c", wrapped], {
        maxBuffer: 1024 * 1024 * 5,
    });
    return JSON.parse(stdout.trim() || "[]");
}
async function waitForHealth(url, timeoutMs = 15000) {
    const startedAt = Date.now();
    let lastError = null;
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(`${url}/api/healthz`);
            if (response.ok)
                return;
        }
        catch (error) {
            lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Local API did not become healthy in time: ${String(lastError || "timeout")}`);
}
async function ensurePosIntegrationColumns(schemaName) {
    await runSql(`
    ALTER TABLE ${schemaName}.pos_integrations
      ADD COLUMN IF NOT EXISTS public_webhook_key text,
      ADD COLUMN IF NOT EXISTS tenant_schema_name text;
  `);
    await runSql(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${schemaName}_pos_integrations_public_webhook_key_idx
    ON ${schemaName}.pos_integrations (public_webhook_key);
  `);
    await runSql(`
    CREATE INDEX IF NOT EXISTS ${schemaName}_pos_integrations_tenant_schema_name_idx
    ON ${schemaName}.pos_integrations (tenant_schema_name);
  `);
    await runSql(`
    UPDATE ${schemaName}.pos_integrations
    SET tenant_schema_name = '${schemaName}'
    WHERE tenant_schema_name IS NULL;
  `);
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
async function cleanupTenants() {
    await runSql(`DELETE FROM public.pos_webhook_routes WHERE tenant_schema_name IN ('${TENANT_A}', '${TENANT_B}')`);
    await runSql(`DELETE FROM public.saas_subscription_link WHERE tenant_schema_name IN ('${TENANT_A}', '${TENANT_B}')`);
    for (const schemaName of TEST_SCHEMAS) {
        await runSql(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    }
}
async function provisionTenant(record) {
    const payload = {
        source: "local-test",
        tenant: {
            strategy: "shared_database_separate_schema",
            schemaName: record.schema,
            platrCustomerId: record.customerId,
            platrSubscriptionId: record.customerId,
        },
        customer: {
            id: record.customerId,
            email: record.email,
            name: record.name,
            company: record.company,
            status: "active",
        },
        package: {
            id: 1,
            slug: "growth",
            name: "Growth",
        },
        subscription: {
            id: record.customerId,
            packageId: 1,
            plan: "monthly",
            status: "active",
            currentPeriodStart: new Date("2026-05-26T00:00:00.000Z").toISOString(),
            currentPeriodEnd: new Date("2026-06-26T00:00:00.000Z").toISOString(),
            cancelAtPeriodEnd: false,
        },
        payment: { provider: "manual-test" },
        invoice: { note: "tenant-isolation" },
    };
    const { response, body } = await httpJson("/api/internal/saas/provision", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.PLATR_LINK_SHARED_SECRET}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
    assert.equal(response.status, 201, `Failed to provision ${record.schema}: ${JSON.stringify(body)}`);
}
async function createIntegration(schema, restaurantId) {
    const payload = {
        name: `Petpooja ${schema}`,
        provider: "petpooja",
        restaurantId,
        accessToken: "User@123",
        defaultGstPercent: 5,
        defaultOrderType: "dine-in",
        active: true,
        syncOrders: true,
        syncMenuItems: true,
        autoSync: false,
    };
    const { response, body } = await httpJson("/api/pos-integrations", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${ownerToken(schema)}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
    testLogs.push({
        step: "createIntegration",
        schema,
        request: { ...payload, accessToken: "[REDACTED]" },
        responseStatus: response.status,
        responseBody: body,
    });
    assert.equal(response.status, 201, `Failed to create integration for ${schema}: ${JSON.stringify(body)}`);
    assert.equal(body.provider, "petpooja");
    assert.equal(body.tenantSchemaName, schema);
    assert.ok(body.webhookSecret, "Expected webhookSecret in create response");
    assert.ok(body.publicWebhookKey, "Expected publicWebhookKey in create response");
    return body;
}
function petpoojaPayload(orderId, restaurantId, itemName, qty) {
    return {
        event: "orderdetails",
        properties: {
            Order: {
                orderID: orderId,
                customer_invoice_id: orderId,
                created_on: "2026-05-26 10:00:00",
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
async function sendWebhook(integration, payload) {
    const webhookPath = `/api/webhook/petpooja/${integration.tenantSchemaName}/${integration.publicWebhookKey}`;
    const { response, body } = await httpJson(webhookPath, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Webhook-Secret": integration.webhookSecret,
        },
        body: JSON.stringify(payload),
    });
    testLogs.push({
        step: "sendWebhook",
        tenant: integration.tenantSchemaName,
        webhookPath,
        requestPayload: payload,
        responseStatus: response.status,
        responseBody: body,
    });
    return { response, body };
}
async function sendCompactWebhook(integration, identifier, payload) {
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
        step: "sendCompactWebhook",
        tenant: integration.tenantSchemaName,
        webhookPath,
        requestPayload: payload,
        responseStatus: response.status,
        responseBody: body,
    });
    return { response, body };
}
async function invoiceRows(schemaName, invoiceNo) {
    return queryJson(`SELECT id, invoice_no, source_type, customer_name, customer_phone
     FROM ${schemaName}.sales_invoices
     WHERE invoice_no = '${invoiceNo}'`);
}
async function invoiceLineCount(schemaName, invoiceNo) {
    const rows = await queryJson(`SELECT COUNT(*)::int AS count
     FROM ${schemaName}.sales_invoice_lines sil
     JOIN ${schemaName}.sales_invoices si ON si.id = sil.invoice_id
     WHERE si.invoice_no = '${invoiceNo}'`);
    return rows[0]?.count ?? 0;
}
before(async () => {
    loadEnvFile();
    await ensurePublicPosIntegrationColumns();
    await cleanupTenants();
    baseUrl = `http://127.0.0.1:${TEST_API_PORT}`;
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
    for (const record of tenantRecords) {
        await provisionTenant(record);
        await ensurePosIntegrationColumns(record.schema);
        const rows = await queryJson(`SELECT COUNT(*)::int AS count FROM ${record.schema}.sales_invoices`);
        testLogs.push({ step: "baseline", schema: record.schema, invoiceCount: rows[0]?.count ?? 0 });
    }
    integrationA = await createIntegration(TENANT_A, "REST_A");
    integrationB = await createIntegration(TENANT_B, "REST_B");
    assert.equal(integrationA.id, 1, "Expected tenant A integration id 1");
    assert.equal(integrationB.id, 1, "Expected tenant B integration id 1");
    testLogs.push({
        step: "webhookUrls",
        tenantA: `${baseUrl}/api/webhook/petpooja/${integrationA.tenantSchemaName}/${integrationA.publicWebhookKey}`,
        tenantB: `${baseUrl}/api/webhook/petpooja/${integrationB.tenantSchemaName}/${integrationB.publicWebhookKey}`,
    });
});
after(async () => {
    if (apiProcess) {
        apiProcess.kill();
        apiProcess = null;
    }
    await cleanupTenants();
});
test("routes webhooks into the correct tenant schema only", async () => {
    const payloadA = petpoojaPayload("ORDER_A_001", "REST_A", "Chicken Rice", 1);
    const payloadB = petpoojaPayload("ORDER_B_001", "REST_B", "Burger", 2);
    const resultA = await sendWebhook(integrationA, payloadA);
    const resultB = await sendWebhook(integrationB, payloadB);
    assert.equal(resultA.response.status, 200, JSON.stringify(resultA.body));
    assert.equal(resultB.response.status, 200, JSON.stringify(resultB.body));
    const tenantAInvoice = await invoiceRows(TENANT_A, "PP-ORDER_A_001");
    const tenantBInvoice = await invoiceRows(TENANT_B, "PP-ORDER_B_001");
    const crossAinB = await invoiceRows(TENANT_B, "PP-ORDER_A_001");
    const crossBinA = await invoiceRows(TENANT_A, "PP-ORDER_B_001");
    assert.equal(tenantAInvoice.length, 1, "ORDER_A_001 should exist in tenant A only");
    assert.equal(tenantBInvoice.length, 1, "ORDER_B_001 should exist in tenant B only");
    assert.equal(crossAinB.length, 0, "ORDER_A_001 leaked into tenant B");
    assert.equal(crossBinA.length, 0, "ORDER_B_001 leaked into tenant A");
    assert.equal(await invoiceLineCount(TENANT_A, "PP-ORDER_A_001"), 1);
    assert.equal(await invoiceLineCount(TENANT_B, "PP-ORDER_B_001"), 1);
});
test("returns 404 for an invalid webhook key", async () => {
    const { response, body } = await httpJson(`/api/webhook/petpooja/${TENANT_A}/invalid_key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(petpoojaPayload("ORDER_INVALID", "REST_A", "Invalid", 1)),
    });
    testLogs.push({
        step: "invalidWebhook",
        responseStatus: response.status,
        responseBody: body,
    });
    assert.equal(response.status, 404);
    assert.deepEqual(body, { error: "Integration not found or inactive" });
});
test("stores payload only in the tenant addressed by the webhook URL", async () => {
    const payloadForA = petpoojaPayload("ORDER_A_SENT_TO_B", "REST_A", "Moved Payload", 1);
    const result = await sendWebhook(integrationB, payloadForA);
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    const tenantBInvoice = await invoiceRows(TENANT_B, "PP-ORDER_A_SENT_TO_B");
    const tenantAInvoice = await invoiceRows(TENANT_A, "PP-ORDER_A_SENT_TO_B");
    assert.equal(tenantBInvoice.length, 1, "Payload addressed to tenant B should be stored in tenant B");
    assert.equal(tenantAInvoice.length, 0, "Payload addressed to tenant B must not leak into tenant A");
});
test("routes compact tenant hash and custom slug webhooks into the correct tenant schema", async () => {
    const hashPayload = petpoojaPayload("ORDER_A_HASH_ONLY", "REST_A", "Hash Route", 1);
    const hashResult = await sendCompactWebhook(integrationA, integrationA.publicWebhookKey, hashPayload);
    assert.equal(hashResult.response.status, 200, JSON.stringify(hashResult.body));
    const patch = await httpJson(`/api/pos-integrations/${integrationA.id}`, {
        method: "PATCH",
        headers: {
            Authorization: `Bearer ${ownerToken(TENANT_A)}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ webhookIdentifier: "tenant-a-pos" }),
    });
    assert.equal(patch.response.status, 200, JSON.stringify(patch.body));
    integrationA = { ...patch.body, webhookSecret: integrationA.webhookSecret };
    const slugPayload = petpoojaPayload("ORDER_A_CUSTOM_SLUG", "REST_A", "Slug Route", 1);
    const slugResult = await sendCompactWebhook(integrationA, "tenant-a-pos", slugPayload);
    assert.equal(slugResult.response.status, 200, JSON.stringify(slugResult.body));
    const tenantAHashInvoice = await invoiceRows(TENANT_A, "PP-ORDER_A_HASH_ONLY");
    const tenantASlugInvoice = await invoiceRows(TENANT_A, "PP-ORDER_A_CUSTOM_SLUG");
    const tenantBHashLeak = await invoiceRows(TENANT_B, "PP-ORDER_A_HASH_ONLY");
    const tenantBSlugLeak = await invoiceRows(TENANT_B, "PP-ORDER_A_CUSTOM_SLUG");
    assert.equal(tenantAHashInvoice.length, 1, "Compact hash route should insert into tenant A");
    assert.equal(tenantASlugInvoice.length, 1, "Compact custom slug route should insert into tenant A");
    assert.equal(tenantBHashLeak.length, 0, "Compact hash route leaked into tenant B");
    assert.equal(tenantBSlugLeak.length, 0, "Compact slug route leaked into tenant B");
});
test("prints a verification summary for manual review", async () => {
    console.log(JSON.stringify({
        createdTenants: tenantRecords.map((record) => record.schema),
        webhookUrls: {
            tenantA: `${baseUrl}/api/webhook/petpooja/${integrationA.tenantSchemaName}/${integrationA.publicWebhookKey}`,
            tenantB: `${baseUrl}/api/webhook/petpooja/${integrationB.tenantSchemaName}/${integrationB.publicWebhookKey}`,
        },
        logs: testLogs,
    }, null, 2));
});
