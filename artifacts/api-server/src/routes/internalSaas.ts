import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, pool, saasSubscriptionLinkTable, systemConfigTable } from "@workspace/db";
import { hashPassword } from "../lib/auth";
import { getSaasAccessState, requirePlatrInternalSecret } from "../lib/saas";

const router: IRouter = Router();

const SyncBody = z.object({
  platrCustomerId: z.coerce.number().int().positive(),
  platrSubscriptionId: z.coerce.number().int().positive().nullable().optional(),
  platrPackageId: z.coerce.number().int().positive().nullable().optional(),
  platrCustomerEmail: z.string().email().nullable().optional(),
  platrCustomerName: z.string().trim().min(1).nullable().optional(),
  companyName: z.string().trim().min(1).nullable().optional(),
  packageSlug: z.string().trim().min(1).nullable().optional(),
  packageName: z.string().trim().min(1).nullable().optional(),
  plan: z.string().trim().min(1).nullable().optional(),
  subscriptionStatus: z.string().trim().min(1).default("pending"),
  customerStatus: z.string().trim().min(1).default("active"),
  currentPeriodStart: z.string().datetime().nullable().optional(),
  currentPeriodEnd: z.string().datetime().nullable().optional(),
  graceEndsAt: z.string().datetime().nullable().optional(),
  paymentFailedAt: z.string().datetime().nullable().optional(),
  trialEndsAt: z.string().datetime().nullable().optional(),
  cancelAtPeriodEnd: z.boolean().optional().default(false),
  epicpoetryInstanceKey: z.string().trim().min(1).nullable().optional(),
  features: z.union([z.record(z.any()), z.array(z.string())]).optional().default({}),
  billingMeta: z.record(z.any()).optional().default({}),
  syncSource: z.string().trim().min(1).optional().default("platr-link"),
});

const PlatrNestedBody = z.object({
  source: z.string().trim().min(1).optional().default("platr-link"),
  event: z.string().trim().min(1).optional(),
  tenant: z.object({
    strategy: z.string().trim().min(1).optional().default("shared_database_separate_schema"),
    externalId: z.string().trim().min(1).optional(),
    schemaName: z.string().trim().min(1),
    platrCustomerId: z.coerce.number().int().positive(),
    platrSubscriptionId: z.coerce.number().int().positive().nullable().optional(),
  }).passthrough(),
  customer: z.object({
    id: z.coerce.number().int().positive(),
    email: z.string().email().nullable().optional(),
    name: z.string().trim().min(1).nullable().optional(),
    phone: z.string().nullable().optional(),
    company: z.string().trim().min(1).nullable().optional(),
    status: z.string().trim().min(1).optional().default("active"),
  }).passthrough(),
  package: z.object({
    id: z.coerce.number().int().positive(),
    slug: z.string().trim().min(1).nullable().optional(),
    name: z.string().trim().min(1).nullable().optional(),
  }).nullable().optional(),
  subscription: z.object({
    id: z.coerce.number().int().positive(),
    packageId: z.coerce.number().int().positive().nullable().optional(),
    plan: z.string().trim().min(1).nullable().optional(),
    status: z.string().trim().min(1).default("pending"),
    currentPeriodStart: z.string().datetime().nullable().optional(),
    currentPeriodEnd: z.string().datetime().nullable().optional(),
    graceEndsAt: z.string().datetime().nullable().optional(),
    paymentFailedAt: z.string().datetime().nullable().optional(),
    cancelAtPeriodEnd: z.boolean().optional().default(false),
  }).passthrough(),
  payment: z.record(z.any()).nullable().optional(),
  invoice: z.record(z.any()).nullable().optional(),
}).passthrough();

type SyncInput = z.infer<typeof SyncBody> & {
  tenantStrategy?: string;
  tenantExternalId?: string | null;
  tenantSchemaName?: string | null;
};

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  return new Date(value);
}

function normalizeSchemaName(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized || !/^[a-z][a-z0-9_]{0,62}$/.test(normalized)) return null;
  if (normalized === "public" || normalized.startsWith("pg_") || normalized === "information_schema") return null;
  return normalized;
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function normalizePayload(body: unknown): SyncInput | null {
  const nested = PlatrNestedBody.safeParse(body);
  if (nested.success) {
    const input = nested.data;
    const pkg = input.package ?? null;
    const billingMeta = {
      provider: "razorpay",
      event: input.event,
      payment: input.payment ?? null,
      invoice: input.invoice ?? null,
    };

    return {
      platrCustomerId: input.customer.id,
      platrSubscriptionId: input.subscription.id,
      platrPackageId: input.subscription.packageId ?? pkg?.id ?? null,
      platrCustomerEmail: input.customer.email ?? null,
      platrCustomerName: input.customer.name ?? null,
      companyName: input.customer.company ?? null,
      packageSlug: pkg?.slug ?? null,
      packageName: pkg?.name ?? null,
      plan: input.subscription.plan ?? null,
      subscriptionStatus: input.subscription.status,
      customerStatus: input.customer.status,
      currentPeriodStart: input.subscription.currentPeriodStart ?? null,
      currentPeriodEnd: input.subscription.currentPeriodEnd ?? null,
      graceEndsAt: input.subscription.graceEndsAt ?? null,
      paymentFailedAt: input.subscription.paymentFailedAt ?? null,
      trialEndsAt: null,
      cancelAtPeriodEnd: input.subscription.cancelAtPeriodEnd ?? false,
      epicpoetryInstanceKey: input.tenant.externalId ?? null,
      features: {},
      billingMeta,
      syncSource: input.source ?? "platr-link",
      tenantStrategy: input.tenant.strategy,
      tenantExternalId: input.tenant.externalId ?? null,
      tenantSchemaName: normalizeSchemaName(input.tenant.schemaName),
    };
  }

  const flat = SyncBody.safeParse(body);
  if (!flat.success) return null;
  return flat.data;
}

async function maybeHydrateCafeName(companyName: string | null | undefined) {
  if (!companyName) return;
  const rows = await db.select().from(systemConfigTable);
  const config = rows[0];
  if (!config) return;

  const currentName = (config.cafeName || "").trim().toLowerCase();
  if (!currentName || currentName === "platr") {
    await db.update(systemConfigTable)
      .set({ cafeName: companyName.trim() })
      .where(eq(systemConfigTable.id, config.id));
  }
}

async function createTenantSchema(schemaName: string): Promise<void> {
  const schemaIdent = quoteIdent(schemaName);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`create schema if not exists ${schemaIdent}`);

    const tableRows = await client.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'
        and table_name <> 'saas_subscription_link'
      order by table_name
    `);

    for (const row of tableRows.rows) {
      const tableIdent = quoteIdent(row.table_name);
      await client.query(`create table if not exists ${schemaIdent}.${tableIdent} (like public.${tableIdent} including all)`);
    }

    const sequenceRows = await client.query<{ sequence_name: string }>(`
      select sequence_name
      from information_schema.sequences
      where sequence_schema = 'public'
      order by sequence_name
    `);

    for (const row of sequenceRows.rows) {
      const seqIdent = quoteIdent(row.sequence_name);
      await client.query(`create sequence if not exists ${schemaIdent}.${seqIdent}`);
    }

    const serialDefaults = await client.query<{ table_name: string; column_name: string; column_default: string }>(`
      select table_name, column_name, column_default
      from information_schema.columns
      where table_schema = 'public'
        and table_name <> 'saas_subscription_link'
        and column_default like 'nextval(%'
    `);

    for (const row of serialDefaults.rows) {
      const match = row.column_default.match(/nextval\('(?:public\.)?([^']+)'::regclass\)/);
      if (!match) continue;
      const sequenceName = match[1].replace(/^public\./, "");
      await client.query(
        `alter table ${schemaIdent}.${quoteIdent(row.table_name)} alter column ${quoteIdent(row.column_name)} set default nextval('${schemaName}.${sequenceName}'::regclass)`,
      );
    }

    for (const table of ["roles", "role_permissions", "system_config", "categories", "uom", "expense_cost_types"]) {
      await client.query(`
        insert into ${schemaIdent}.${quoteIdent(table)}
        select * from public.${quoteIdent(table)}
        where not exists (select 1 from ${schemaIdent}.${quoteIdent(table)} limit 1)
      `);
    }

    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function ensureTenantOwnerUser(input: SyncInput): Promise<void> {
  if (!input.tenantSchemaName || !input.platrCustomerEmail) return;
  const schemaIdent = quoteIdent(input.tenantSchemaName);
  const password = process.env.SAAS_TENANT_OWNER_DEFAULT_PASSWORD ?? "ChangeMe123!";
  const passwordHash = hashPassword(password);
  await pool.query(
    `
      insert into ${schemaIdent}.users (username, password_hash, full_name, email, role, active)
      values ($1, $2, $3, $4, 'owner', true)
      on conflict (username) do update set
        full_name = excluded.full_name,
        email = excluded.email,
        role = case when ${schemaIdent}.users.role in ('admin', 'owner') then ${schemaIdent}.users.role else 'owner' end,
        active = true
    `,
    [
      input.platrCustomerEmail,
      passwordHash,
      input.platrCustomerName ?? input.companyName ?? input.platrCustomerEmail,
      input.platrCustomerEmail,
    ],
  );
}

async function upsertLink(input: SyncInput) {
  const [existing] = await db.select()
    .from(saasSubscriptionLinkTable)
    .where(eq(saasSubscriptionLinkTable.platrCustomerId, input.platrCustomerId))
    .limit(1);

  const values = {
    platrCustomerId: input.platrCustomerId,
    platrSubscriptionId: input.platrSubscriptionId ?? null,
    platrPackageId: input.platrPackageId ?? null,
    platrCustomerEmail: input.platrCustomerEmail ?? null,
    platrCustomerName: input.platrCustomerName ?? null,
    companyName: input.companyName ?? null,
    packageSlug: input.packageSlug ?? null,
    packageName: input.packageName ?? null,
    plan: input.plan ?? null,
    subscriptionStatus: input.subscriptionStatus,
    customerStatus: input.customerStatus,
    currentPeriodStart: parseDate(input.currentPeriodStart),
    currentPeriodEnd: parseDate(input.currentPeriodEnd),
    graceEndsAt: parseDate(input.graceEndsAt),
    paymentFailedAt: parseDate(input.paymentFailedAt),
    trialEndsAt: parseDate(input.trialEndsAt),
    cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
    epicpoetryInstanceKey: input.epicpoetryInstanceKey ?? null,
    tenantStrategy: input.tenantStrategy ?? (input.tenantSchemaName ? "shared_database_separate_schema" : "single_instance"),
    tenantExternalId: input.tenantExternalId ?? null,
    tenantSchemaName: input.tenantSchemaName ?? null,
    featuresJson: input.features ?? {},
    billingMeta: input.billingMeta ?? {},
    lastSyncedAt: new Date(),
    lastSyncSource: input.syncSource ?? "platr-link",
  };

  const row = existing
    ? (await db.update(saasSubscriptionLinkTable)
        .set(values)
        .where(eq(saasSubscriptionLinkTable.id, existing.id))
        .returning())[0]
    : (await db.insert(saasSubscriptionLinkTable).values(values).returning())[0];

  await maybeHydrateCafeName(input.companyName);
  return row;
}

router.get("/internal/saas/status", requirePlatrInternalSecret, async (req, res): Promise<void> => {
  const schemaName = typeof req.query.tenantSchemaName === "string" ? req.query.tenantSchemaName : null;
  const state = await getSaasAccessState(schemaName);
  res.json(state);
});

router.post("/internal/saas/provision", requirePlatrInternalSecret, async (req, res): Promise<void> => {
  const input = normalizePayload(req.body);
  if (!input) {
    res.status(400).json({ error: "Invalid SaaS provision payload" });
    return;
  }

  if (input.tenantSchemaName) {
    await createTenantSchema(input.tenantSchemaName);
    await ensureTenantOwnerUser(input);
  }
  const row = await upsertLink(input);
  const state = await getSaasAccessState(input.tenantSchemaName);
  res.status(201).json({ ok: true, mode: "provision", link: row, access: state });
});

router.post("/internal/saas/subscription-sync", requirePlatrInternalSecret, async (req, res): Promise<void> => {
  const input = normalizePayload(req.body);
  if (!input) {
    res.status(400).json({ error: "Invalid SaaS subscription sync payload" });
    return;
  }

  if (input.tenantSchemaName) {
    await createTenantSchema(input.tenantSchemaName);
  }
  const row = await upsertLink(input);
  const state = await getSaasAccessState();
  res.json({ ok: true, mode: "sync", link: row, access: state });
});

export default router;




