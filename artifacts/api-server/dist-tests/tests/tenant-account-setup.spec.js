import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { SMTPServer } from "smtp-server";
const TEST_SCHEMA = "tenant_auth_setup_spec";
const TEST_API_PORT = 3118;
const TEST_SMTP_PORT = 2525;
const TEST_CUSTOMER_EMAIL = "tenant.setup@example.com";
const TEST_CUSTOMER_NAME = "Tenant Setup User";
const TEST_COMPANY = "Tenant Setup Cafe";
const TEST_PASSWORD = "SetupPass123";
const TEST_RESET_PASSWORD = "ResetPass456";
const TEST_CHANGED_PASSWORD = "ChangedPass789";
const LEGACY_USERNAME = "legacy.user";
const LEGACY_PASSWORD = "legacy123";
const execFileAsync = promisify(execFile);
let apiProcess = null;
let smtpServer = null;
let baseUrl = "";
const receivedMessages = [];
let loginToken = "";
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
        if (!(key in process.env))
            process.env[key] = value;
    }
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
async function waitForHealth(url, timeoutMs = 15000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(`${url}/api/healthz`);
            if (response.ok)
                return;
        }
        catch { }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Local API did not become healthy in time");
}
function legacyHash(password) {
    return crypto.createHash("sha256").update(password).digest("hex");
}
async function httpJson(pathname, init) {
    const response = await fetch(`${baseUrl}${pathname}`, init);
    const text = await response.text();
    let body = null;
    try {
        body = text ? JSON.parse(text) : null;
    }
    catch {
        body = text;
    }
    return { response, body };
}
function extractLink(kind) {
    for (let i = receivedMessages.length - 1; i >= 0; i -= 1) {
        const normalized = receivedMessages[i]
            .replace(/=\r?\n/g, "")
            .replace(/=3D/g, "=")
            .replace(/&amp;/g, "&");
        const match = normalized.match(new RegExp(`https?://[^\\s\"<>]+/${kind}/[^\\s\"<>]+`, "i"));
        if (match)
            return match[0];
    }
    throw new Error(`Could not find ${kind} link in captured SMTP messages`);
}
function extractTokenFromLink(url) {
    return decodeURIComponent(url.split("/").pop() || "");
}
async function provisionTenant() {
    const payload = {
        source: "local-test",
        tenant: {
            strategy: "shared_database_separate_schema",
            schemaName: TEST_SCHEMA,
            platrCustomerId: 9201,
            platrSubscriptionId: 9201,
        },
        customer: {
            id: 9201,
            email: TEST_CUSTOMER_EMAIL,
            name: TEST_CUSTOMER_NAME,
            company: TEST_COMPANY,
            status: "active",
        },
        package: {
            id: 1,
            slug: "growth",
            name: "Growth",
        },
        subscription: {
            id: 9201,
            packageId: 1,
            plan: "monthly",
            status: "active",
            currentPeriodStart: new Date("2026-05-29T00:00:00.000Z").toISOString(),
            currentPeriodEnd: new Date("2026-06-29T00:00:00.000Z").toISOString(),
            cancelAtPeriodEnd: false,
        },
        payment: { provider: "manual-test" },
        invoice: { note: "tenant-account-setup" },
    };
    const { response, body } = await httpJson("/api/internal/saas/provision", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.PLATR_LINK_SHARED_SECRET}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
    assert.equal(response.status, 201, `Provisioning failed: ${JSON.stringify(body)}`);
}
async function setupMailConfig() {
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = String(TEST_SMTP_PORT);
    process.env.SMTP_FROM = "noreply@example.com";
    process.env.SMTP_FROM_NAME = "Platr QA";
    process.env.SMTP_SECURE = "false";
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    await runSql(`
    DELETE FROM public.mail_config;
    INSERT INTO public.mail_config (smtp_host, smtp_port, from_email, from_name, secure, enabled)
    VALUES ('127.0.0.1', ${TEST_SMTP_PORT}, 'noreply@example.com', 'Platr QA', false, true);
  `);
}
before(async () => {
    loadEnvFile();
    baseUrl = `http://127.0.0.1:${TEST_API_PORT}`;
    smtpServer = new SMTPServer({
        authOptional: true,
        disabledCommands: ["STARTTLS", "AUTH"],
        onData(stream, _session, callback) {
            let raw = "";
            stream.setEncoding("utf8");
            stream.on("data", (chunk) => {
                raw += chunk;
            });
            stream.on("end", () => {
                receivedMessages.push(raw);
                callback();
            });
        },
    });
    await new Promise((resolve, reject) => {
        smtpServer.listen(TEST_SMTP_PORT, "127.0.0.1", (err) => (err ? reject(err) : resolve()));
    });
    await runSql(`DELETE FROM public.saas_subscription_link WHERE tenant_schema_name = '${TEST_SCHEMA}'`);
    await runSql(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await setupMailConfig();
    apiProcess = spawn("node", ["dist/index.mjs"], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            API_PORT: String(TEST_API_PORT),
            SITE_URL: "http://127.0.0.1:4174",
        },
        stdio: "inherit",
    });
    await waitForHealth(baseUrl);
    await provisionTenant();
});
after(async () => {
    apiProcess?.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (smtpServer) {
        await new Promise((resolve, reject) => smtpServer.close((err) => (err ? reject(err) : resolve())));
    }
    await runSql(`DELETE FROM public.saas_subscription_link WHERE tenant_schema_name = '${TEST_SCHEMA}'`).catch(() => undefined);
    await runSql(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`).catch(() => undefined);
    await runSql(`DELETE FROM public.mail_config`).catch(() => undefined);
});
test("tenant owner is created without password and setup email is generated", async () => {
    const users = await queryJson(`select username, password_hash, password_set, email from ${TEST_SCHEMA}.users where username = '${TEST_CUSTOMER_EMAIL}'`);
    assert.equal(users.length, 1);
    assert.equal(users[0].password_hash, null);
    assert.equal(users[0].password_set, false);
    assert.equal(users[0].email, TEST_CUSTOMER_EMAIL);
    const emailText = receivedMessages.join("\n---\n");
    assert.match(emailText, new RegExp(TEST_CUSTOMER_NAME));
    assert.match(emailText, new RegExp(TEST_COMPANY));
    assert.match(emailText, new RegExp(TEST_CUSTOMER_EMAIL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(emailText, /create-password\//);
});
test("login is blocked before password setup, token can be consumed once, and login succeeds after setup", async () => {
    const blocked = await httpJson("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: TEST_CUSTOMER_EMAIL, password: "anything" }),
    });
    assert.equal(blocked.response.status, 403);
    assert.equal(blocked.body?.reason, "password_setup_required");
    const setupUrl = extractLink("create-password");
    const setupToken = extractTokenFromLink(setupUrl);
    const inspection = await httpJson(`/api/auth/password-tokens/${encodeURIComponent(setupToken)}`);
    assert.equal(inspection.response.status, 200);
    assert.equal(inspection.body?.purpose, "password_setup");
    assert.equal(inspection.body?.requiresPasswordInput, true);
    const completed = await httpJson("/api/auth/password-tokens/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: setupToken, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD }),
    });
    assert.equal(completed.response.status, 200);
    const reused = await httpJson("/api/auth/password-tokens/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: setupToken, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD }),
    });
    assert.equal(reused.response.status, 409);
    const login = await httpJson("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: TEST_CUSTOMER_EMAIL, password: TEST_PASSWORD }),
    });
    assert.equal(login.response.status, 200);
    assert.ok(login.body?.token);
    loginToken = login.body.token;
});
test("expired token is rejected", async () => {
    const { response } = await httpJson("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: TEST_CUSTOMER_EMAIL }),
    });
    assert.equal(response.status, 200);
    const resetUrl = extractLink("reset-password");
    const resetToken = extractTokenFromLink(resetUrl);
    await runSql(`
    UPDATE ${TEST_SCHEMA}.auth_tokens
    SET expires_at = now() - interval '1 hour'
    WHERE purpose = 'password_reset'
      AND used_at IS NULL
  `);
    const expired = await httpJson("/api/auth/password-tokens/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, password: TEST_RESET_PASSWORD, confirmPassword: TEST_RESET_PASSWORD }),
    });
    assert.equal(expired.response.status, 410);
});
test("forgot password works and change password requires email verification", async () => {
    const forgot = await httpJson("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: TEST_CUSTOMER_EMAIL }),
    });
    assert.equal(forgot.response.status, 200);
    const resetUrl = extractLink("reset-password");
    const resetToken = extractTokenFromLink(resetUrl);
    const resetComplete = await httpJson("/api/auth/password-tokens/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, password: TEST_RESET_PASSWORD, confirmPassword: TEST_RESET_PASSWORD }),
    });
    assert.equal(resetComplete.response.status, 200);
    const oldPasswordLogin = await httpJson("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: TEST_CUSTOMER_EMAIL, password: TEST_PASSWORD }),
    });
    assert.equal(oldPasswordLogin.response.status, 401);
    const resetPasswordLogin = await httpJson("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: TEST_CUSTOMER_EMAIL, password: TEST_RESET_PASSWORD }),
    });
    assert.equal(resetPasswordLogin.response.status, 200);
    loginToken = resetPasswordLogin.body.token;
    const changeRequest = await httpJson("/api/auth/change-password", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${loginToken}`,
        },
        body: JSON.stringify({ currentPassword: TEST_RESET_PASSWORD, newPassword: TEST_CHANGED_PASSWORD }),
    });
    assert.equal(changeRequest.response.status, 200);
    assert.match(String(changeRequest.body?.message || ""), /Verification email sent/i);
    const changeUrl = extractLink("change-password");
    const changeToken = extractTokenFromLink(changeUrl);
    const changeInfo = await httpJson(`/api/auth/password-tokens/${encodeURIComponent(changeToken)}`);
    assert.equal(changeInfo.response.status, 200);
    assert.equal(changeInfo.body?.requiresPasswordInput, false);
    const confirmChange = await httpJson("/api/auth/password-tokens/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: changeToken }),
    });
    assert.equal(confirmChange.response.status, 200);
    const staleLogin = await httpJson("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: TEST_CUSTOMER_EMAIL, password: TEST_RESET_PASSWORD }),
    });
    assert.equal(staleLogin.response.status, 401);
    const changedLogin = await httpJson("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: TEST_CUSTOMER_EMAIL, password: TEST_CHANGED_PASSWORD }),
    });
    assert.equal(changedLogin.response.status, 200);
});
test("existing tenant users with legacy password hashes continue working", async () => {
    await runSql(`
    INSERT INTO ${TEST_SCHEMA}.users (username, password_hash, password_set, full_name, email, role, active)
    VALUES ('${LEGACY_USERNAME}', '${legacyHash(LEGACY_PASSWORD)}', false, 'Legacy User', 'legacy@example.com', 'manager', true)
    ON CONFLICT (username) DO UPDATE
    SET password_hash = excluded.password_hash,
        password_set = false,
        full_name = excluded.full_name,
        email = excluded.email,
        role = excluded.role,
        active = true
  `);
    const legacyLogin = await httpJson("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: LEGACY_USERNAME, password: LEGACY_PASSWORD, tenant: TEST_SCHEMA }),
    });
    assert.equal(legacyLogin.response.status, 200);
});
