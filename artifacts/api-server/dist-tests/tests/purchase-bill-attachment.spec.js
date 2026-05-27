import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { HeadObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
const TEST_SCHEMA = "tenant_purchase_bill_schema";
const TEST_API_PORT = 3117;
const MAX_TEST_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const execFileAsync = promisify(execFile);
let apiProcess = null;
let baseUrl = "";
let vendorId = 0;
let ingredientId = 0;
const createdS3Keys = new Set();
let s3Client;
let bucketName = "";
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
    if (!databaseUrl)
        throw new Error("DATABASE_URL is not configured");
    await execFileAsync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-c", sql], { maxBuffer: 1024 * 1024 * 10 });
}
async function queryJson(sql) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl)
        throw new Error("DATABASE_URL is not configured");
    const wrapped = `select coalesce(json_agg(t), '[]'::json)::text from (${sql}) t;`;
    const { stdout } = await execFileAsync("psql", [databaseUrl, "-At", "-v", "ON_ERROR_STOP=1", "-c", wrapped], {
        maxBuffer: 1024 * 1024 * 10,
    });
    return JSON.parse(stdout.trim() || "[]");
}
async function queryJsonDirect(sql) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl)
        throw new Error("DATABASE_URL is not configured");
    const { stdout } = await execFileAsync("psql", [databaseUrl, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], {
        maxBuffer: 1024 * 1024 * 10,
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
async function provisionTenant() {
    const payload = {
        source: "local-test",
        tenant: {
            strategy: "shared_database_separate_schema",
            schemaName: TEST_SCHEMA,
            platrCustomerId: 9101,
            platrSubscriptionId: 9101,
        },
        customer: {
            id: 9101,
            email: "purchase.bill@example.com",
            name: "Purchase Bill Tester",
            company: "Purchase Bill Cafe",
            status: "active",
        },
        package: {
            id: 1,
            slug: "growth",
            name: "Growth",
        },
        subscription: {
            id: 9101,
            packageId: 1,
            plan: "monthly",
            status: "active",
            currentPeriodStart: new Date("2026-05-27T00:00:00.000Z").toISOString(),
            currentPeriodEnd: new Date("2026-06-27T00:00:00.000Z").toISOString(),
            cancelAtPeriodEnd: false,
        },
        payment: { provider: "manual-test" },
        invoice: { note: "purchase-bill-attachment" },
    };
    const response = await fetch(`${baseUrl}/api/internal/saas/provision`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.PLATR_LINK_SHARED_SECRET}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
    assert.equal(response.status, 201, `Failed to provision test tenant: ${await response.text()}`);
}
async function seedVendorAndIngredient() {
    const vendorCode = `VND-${Date.now()}`;
    const ingredientCode = `ING-${Date.now()}`;
    const vendorRows = await queryJsonDirect(`with t as (
       insert into ${TEST_SCHEMA}.vendors (code, name, active, preferred)
       values ('${vendorCode}', 'Attachment Vendor', true, false)
       returning id
     )
     select coalesce(json_agg(t), '[]'::json)::text from t`);
    vendorId = Number(vendorRows[0]?.id || 0);
    const ingredientRows = await queryJsonDirect(`with t as (
       insert into ${TEST_SCHEMA}.ingredients (
         code, name, stock_uom, purchase_uom, recipe_uom, conversion_factor,
         current_cost, latest_cost, weighted_avg_cost, reorder_level, current_stock,
         perishable, active, verified
       ) values (
         '${ingredientCode}', 'Attachment Ingredient', 'kg', 'kg', 'kg', 1,
         0, 0, 0, 0, 0, false, true, false
       )
       returning id
     )
     select coalesce(json_agg(t), '[]'::json)::text from t`);
    ingredientId = Number(ingredientRows[0]?.id || 0);
    assert.ok(vendorId > 0, "Vendor seed failed");
    assert.ok(ingredientId > 0, "Ingredient seed failed");
}
async function createPurchaseRequest(body, headers) {
    return fetch(`${baseUrl}/api/purchases`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${ownerToken(TEST_SCHEMA)}`,
            ...(headers || {}),
        },
        body,
    });
}
async function updatePurchaseRequest(id, body, headers) {
    return fetch(`${baseUrl}/api/purchases/${id}`, {
        method: "PATCH",
        headers: {
            Authorization: `Bearer ${ownerToken(TEST_SCHEMA)}`,
            ...(headers || {}),
        },
        body,
    });
}
function purchasePayload(invoiceNumber) {
    return {
        purchaseDate: "2026-05-27",
        vendorId,
        invoiceNumber,
        paymentStatus: "unpaid",
        lines: [
            {
                ingredientId,
                quantity: 2,
                purchaseUom: "kg",
                unitRate: 150,
                taxPercent: 5,
            },
        ],
    };
}
function trackAttachmentFromBody(body) {
    return body;
}
function extractStoredAttachment(raw) {
    const trimmed = String(raw || "").trim();
    if (!trimmed || !trimmed.startsWith("{"))
        return null;
    const parsed = JSON.parse(trimmed);
    if (parsed?.storage === "s3" && parsed?.key) {
        return {
            key: String(parsed.key),
            name: String(parsed.name || ""),
            type: String(parsed.type || ""),
        };
    }
    return null;
}
before(async () => {
    loadEnvFile();
    baseUrl = `http://127.0.0.1:${TEST_API_PORT}`;
    bucketName = String(process.env.AWS_STORAGE_BUCKET_NAME || "").trim();
    s3Client = new S3Client({ region: process.env.AWS_S3_REGION_NAME });
    await runSql(`DELETE FROM public.saas_subscription_link WHERE tenant_schema_name = '${TEST_SCHEMA}'`);
    await runSql(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    apiProcess = spawn("node", ["dist/index.mjs"], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            API_PORT: String(TEST_API_PORT),
        },
        stdio: "inherit",
    });
    await waitForHealth(baseUrl);
    await provisionTenant();
    await seedVendorAndIngredient();
});
after(async () => {
    await runSql(`drop schema if exists ${TEST_SCHEMA} cascade`).catch(() => undefined);
    await runSql(`delete from public.saas_subscription_link where tenant_schema_name = '${TEST_SCHEMA}'`).catch(() => undefined);
    for (const key of createdS3Keys) {
        await s3Client.send(new DeleteObjectCommand({
            Bucket: bucketName,
            Key: key,
        })).catch(() => undefined);
    }
    if (apiProcess) {
        apiProcess.kill();
        apiProcess = null;
    }
});
test("create purchase without file succeeds", async () => {
    const response = await createPurchaseRequest(JSON.stringify(purchasePayload("ATT-NOFILE-001")), {
        "Content-Type": "application/json",
    });
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    assert.equal(body.billAttachmentUrl, null);
    assert.equal(body.billAttachmentName, null);
    assert.equal(body.billAttachmentType, null);
});
test("upload image bill succeeds", async () => {
    const form = new FormData();
    form.append("payload", JSON.stringify(purchasePayload("ATT-IMG-001")));
    form.append("billAttachment", new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], "bill-image.jpg", { type: "image/jpeg" }));
    const response = await createPurchaseRequest(form);
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    assert.match(String(body.billAttachmentUrl), /^https:\/\/.+X-Amz-Signature=/);
    assert.equal(body.billAttachmentType, "image/jpeg");
    assert.equal(String(body.billAttachmentName).endsWith(".jpg"), true);
    const rows = await queryJson(`select bill_attachment from ${TEST_SCHEMA}.purchases where id = ${Number(body.id)}`);
    const stored = extractStoredAttachment(rows[0]?.bill_attachment);
    assert.ok(stored?.key);
    createdS3Keys.add(stored.key);
    await s3Client.send(new HeadObjectCommand({
        Bucket: bucketName,
        Key: stored.key,
    }));
});
test("upload pdf bill succeeds", async () => {
    const form = new FormData();
    form.append("payload", JSON.stringify(purchasePayload("ATT-PDF-001")));
    form.append("billAttachment", new File([Buffer.from("%PDF-1.4\n%%EOF")], "bill.pdf", { type: "application/pdf" }));
    const response = await createPurchaseRequest(form);
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    assert.equal(body.billAttachmentType, "application/pdf");
    assert.match(String(body.billAttachmentUrl), /^https:\/\/.+X-Amz-Signature=/);
    const rows = await queryJson(`select bill_attachment from ${TEST_SCHEMA}.purchases where id = ${Number(body.id)}`);
    const stored = extractStoredAttachment(rows[0]?.bill_attachment);
    assert.ok(stored?.key);
    createdS3Keys.add(stored.key);
    await s3Client.send(new HeadObjectCommand({
        Bucket: bucketName,
        Key: stored.key,
    }));
});
test("invalid file type fails", async () => {
    const form = new FormData();
    form.append("payload", JSON.stringify(purchasePayload("ATT-BADTYPE-001")));
    form.append("billAttachment", new File([Buffer.from("not allowed")], "bill.txt", { type: "text/plain" }));
    const response = await createPurchaseRequest(form);
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.match(String(body.error), /Unsupported bill attachment format/i);
    const rows = await queryJson(`select count(*)::int as count from ${TEST_SCHEMA}.purchases where invoice_number = 'ATT-BADTYPE-001'`);
    assert.equal(Number(rows[0]?.count || 0), 0);
});
test("file larger than 10 MB fails", async () => {
    const form = new FormData();
    form.append("payload", JSON.stringify(purchasePayload("ATT-TOOBIG-001")));
    form.append("billAttachment", new File([new Uint8Array(MAX_TEST_ATTACHMENT_SIZE + 1)], "bill-big.pdf", { type: "application/pdf" }));
    const response = await createPurchaseRequest(form);
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.match(String(body.error), /10 MB or smaller/i);
    const rows = await queryJson(`select count(*)::int as count from ${TEST_SCHEMA}.purchases where invoice_number = 'ATT-TOOBIG-001'`);
    assert.equal(Number(rows[0]?.count || 0), 0);
});
test("edit purchase with new file and then remove attachment", async () => {
    const createResponse = await createPurchaseRequest(JSON.stringify(purchasePayload("ATT-EDIT-001")), {
        "Content-Type": "application/json",
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 201);
    const updateForm = new FormData();
    updateForm.append("payload", JSON.stringify({
        ...purchasePayload("ATT-EDIT-001"),
        removeBillAttachment: false,
    }));
    updateForm.append("billAttachment", new File([Buffer.from("%PDF-1.4\n%%EOF")], "replacement.pdf", { type: "application/pdf" }));
    const updateResponse = await updatePurchaseRequest(created.id, updateForm);
    const updated = await updateResponse.json();
    assert.equal(updateResponse.status, 200, JSON.stringify(updated));
    assert.equal(updated.billAttachmentType, "application/pdf");
    const updatedRows = await queryJson(`select bill_attachment from ${TEST_SCHEMA}.purchases where id = ${Number(created.id)}`);
    const storedUpdated = extractStoredAttachment(updatedRows[0]?.bill_attachment);
    assert.ok(storedUpdated?.key);
    createdS3Keys.add(storedUpdated.key);
    await s3Client.send(new HeadObjectCommand({
        Bucket: bucketName,
        Key: storedUpdated.key,
    }));
    const removeForm = new FormData();
    removeForm.append("payload", JSON.stringify({
        ...purchasePayload("ATT-EDIT-001"),
        removeBillAttachment: true,
    }));
    removeForm.append("removeBillAttachment", "true");
    const removeResponse = await updatePurchaseRequest(created.id, removeForm);
    const removed = await removeResponse.json();
    assert.equal(removeResponse.status, 200, JSON.stringify(removed));
    assert.equal(removed.billAttachmentUrl, null);
    assert.equal(removed.billAttachmentName, null);
    assert.equal(removed.billAttachmentType, null);
    const rows = await queryJson(`select bill_attachment from ${TEST_SCHEMA}.purchases where id = ${Number(created.id)}`);
    assert.equal(rows[0]?.bill_attachment, null);
});
