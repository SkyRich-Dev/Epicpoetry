import path from "node:path";
import { createRequire } from "node:module";

process.loadEnvFile(path.resolve(process.cwd(), ".env"));

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

const requireFromDb = createRequire(path.resolve(process.cwd(), "lib/db/package.json"));
const { Client } = requireFromDb("pg");

const TENANT_SCHEMA_PATTERN = "tenant_platr_%";
const SKIPPED_TABLES = new Set(["saas_subscription_link", "pos_webhook_routes"]);

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function tenantSearchPath(schemaName) {
  return `${quoteIdent(schemaName)}, public`;
}

function normalizeDefaultExpression(defaultExpr, tenantSchemaName) {
  if (!defaultExpr) return null;
  return defaultExpr.replace(
    /nextval\('(?:public\.)?([^']+)'::regclass\)/g,
    (_, sequenceName) => `nextval('${tenantSchemaName}.${sequenceName.replace(/^public\./, "")}'::regclass)`,
  );
}

function buildCreateIndexStatement(indexDef, schemaName, tableName, indexName) {
  const normalizedTableName = tableName.replace(/"/g, '""');
  const prefixPattern = new RegExp(
    String.raw`^CREATE\s+(UNIQUE\s+)?INDEX\s+.+?\s+ON\s+public\.(?:"${normalizedTableName}"|${normalizedTableName})\s+`,
    "i",
  );
  const match = indexDef.match(prefixPattern);
  if (!match) return null;
  const uniqueKeyword = match[1] ? "UNIQUE " : "";
  const suffix = indexDef.slice(match[0].length);
  return `CREATE ${uniqueKeyword}INDEX IF NOT EXISTS ${quoteIdent(indexName)} ON ${quoteIdent(schemaName)}.${quoteIdent(tableName)} ${suffix}`;
}

async function ensureTenantSequences(client, schemaName) {
  const { rows } = await client.query(`
    SELECT sequence_name
    FROM information_schema.sequences
    WHERE sequence_schema = 'public'
    ORDER BY sequence_name
  `);

  for (const { sequence_name: sequenceName } of rows) {
    await client.query(`CREATE SEQUENCE IF NOT EXISTS ${quoteIdent(schemaName)}.${quoteIdent(sequenceName)}`);
  }
}

async function ensureTenantTable(client, schemaName, tableName) {
  await client.query(
    `
      CREATE TABLE IF NOT EXISTS ${quoteIdent(schemaName)}.${quoteIdent(tableName)}
      (LIKE public.${quoteIdent(tableName)} INCLUDING ALL)
    `,
  );
}

async function ensureTenantColumns(client, schemaName, tableName) {
  const publicColumns = await client.query(
    `
      SELECT
        a.attname AS column_name,
        pg_catalog.format_type(a.atttypid, a.atttypmod) AS column_type,
        a.attnotnull AS not_null,
        pg_get_expr(ad.adbin, ad.adrelid) AS column_default
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
      WHERE n.nspname = 'public'
        AND c.relname = $1
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY a.attnum
    `,
    [tableName],
  );

  const tenantColumns = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
    `,
    [schemaName, tableName],
  );

  const existingColumns = new Set(tenantColumns.rows.map((row) => row.column_name));

  for (const row of publicColumns.rows) {
    if (existingColumns.has(row.column_name)) continue;

    await client.query(
      `ALTER TABLE ${quoteIdent(schemaName)}.${quoteIdent(tableName)}
       ADD COLUMN IF NOT EXISTS ${quoteIdent(row.column_name)} ${row.column_type}`,
    );

    const normalizedDefault = normalizeDefaultExpression(row.column_default, schemaName);
    if (normalizedDefault) {
      await client.query(
        `ALTER TABLE ${quoteIdent(schemaName)}.${quoteIdent(tableName)}
         ALTER COLUMN ${quoteIdent(row.column_name)} SET DEFAULT ${normalizedDefault}`,
      );
      await client.query(
        `UPDATE ${quoteIdent(schemaName)}.${quoteIdent(tableName)}
         SET ${quoteIdent(row.column_name)} = DEFAULT
         WHERE ${quoteIdent(row.column_name)} IS NULL`,
      );
    }

    if (row.not_null) {
      const emptiness = await client.query(
        `SELECT NOT EXISTS (SELECT 1 FROM ${quoteIdent(schemaName)}.${quoteIdent(tableName)} LIMIT 1) AS is_empty`,
      );
      const tableIsEmpty = Boolean(emptiness.rows[0]?.is_empty);
      if (normalizedDefault || tableIsEmpty) {
        await client.query(
          `ALTER TABLE ${quoteIdent(schemaName)}.${quoteIdent(tableName)}
           ALTER COLUMN ${quoteIdent(row.column_name)} SET NOT NULL`,
        );
      }
    }
  }
}

async function ensureTenantSerialDefaults(client, schemaName, tableName) {
  const { rows } = await client.query(
    `
      SELECT column_name, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_default LIKE 'nextval(%'
    `,
    [tableName],
  );

  for (const row of rows) {
    const normalizedDefault = normalizeDefaultExpression(row.column_default, schemaName);
    if (!normalizedDefault) continue;
    await client.query(
      `ALTER TABLE ${quoteIdent(schemaName)}.${quoteIdent(tableName)}
       ALTER COLUMN ${quoteIdent(row.column_name)} SET DEFAULT ${normalizedDefault}`,
    );
  }
}

async function ensureTenantIndexes(client, schemaName, tableName) {
  const publicIndexes = await client.query(
    `
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = $1
      ORDER BY indexname
    `,
    [tableName],
  );

  for (const { indexname: indexName, indexdef: indexDef } of publicIndexes.rows) {
    if (/_pkey$/i.test(indexName)) continue;
    const createStatement = buildCreateIndexStatement(indexDef, schemaName, tableName, indexName);
    if (!createStatement) continue;
    await client.query(createStatement);
  }
}

async function syncTenantSchema(client, schemaName, publicTables) {
  await client.query("BEGIN");
  try {
    await client.query(`DROP TABLE IF EXISTS ${quoteIdent(schemaName)}."pos_webhook_routes" CASCADE`);
    await ensureTenantSequences(client, schemaName);

    for (const tableName of publicTables) {
      await ensureTenantTable(client, schemaName, tableName);
      await ensureTenantColumns(client, schemaName, tableName);
      await ensureTenantSerialDefaults(client, schemaName, tableName);
      await ensureTenantIndexes(client, schemaName, tableName);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

function normalizeWebhookIdentifier(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(normalized)) return null;
  if (["public", "api", "webhook", "petpooja", "petpooja-global"].includes(normalized)) return null;
  return normalized;
}

async function ensurePosWebhookRouteRows(client, {
  provider,
  identifier,
  routeType,
  tenantSchemaName,
  integrationId,
}) {
  if (!identifier) return;
  await client.query(
    `
      INSERT INTO public.pos_webhook_routes (provider, identifier, route_type, tenant_schema_name, integration_id, active)
      VALUES ($1, $2, $3, $4, $5, true)
      ON CONFLICT (provider, identifier)
      DO UPDATE SET
        route_type = EXCLUDED.route_type,
        tenant_schema_name = EXCLUDED.tenant_schema_name,
        integration_id = EXCLUDED.integration_id,
        active = true,
        updated_at = now()
    `,
    [provider, identifier, routeType, tenantSchemaName, integrationId],
  );
}

async function backfillPosWebhookRoutes(client, tenantSchemas) {
  await client.query(`
    UPDATE public.pos_integrations
    SET legacy_webhook_id = id::text
    WHERE legacy_webhook_id IS NULL
  `);

  const publicRows = await client.query(`
    SELECT id, provider, public_webhook_key, webhook_identifier, legacy_webhook_id, is_legacy_active
    FROM public.pos_integrations
  `);

  for (const row of publicRows.rows) {
    await ensurePosWebhookRouteRows(client, {
      provider: row.provider,
      identifier: row.public_webhook_key,
      routeType: "public_key",
      tenantSchemaName: null,
      integrationId: row.id,
    });
    await ensurePosWebhookRouteRows(client, {
      provider: row.provider,
      identifier: normalizeWebhookIdentifier(row.webhook_identifier),
      routeType: "custom",
      tenantSchemaName: null,
      integrationId: row.id,
    });
    if (row.is_legacy_active !== false) {
      await ensurePosWebhookRouteRows(client, {
        provider: row.provider,
        identifier: row.legacy_webhook_id,
        routeType: "legacy",
        tenantSchemaName: null,
        integrationId: row.id,
      });
    }
  }

  for (const schemaName of tenantSchemas) {
    const rows = await client.query(`
      SELECT id, provider, public_webhook_key, webhook_identifier, legacy_webhook_id, is_legacy_active
      FROM ${quoteIdent(schemaName)}.pos_integrations
    `);

    for (const row of rows.rows) {
      await ensurePosWebhookRouteRows(client, {
        provider: row.provider,
        identifier: row.public_webhook_key,
        routeType: "public_key",
        tenantSchemaName: schemaName,
        integrationId: row.id,
      });
      await ensurePosWebhookRouteRows(client, {
        provider: row.provider,
        identifier: normalizeWebhookIdentifier(row.webhook_identifier),
        routeType: "custom",
        tenantSchemaName: schemaName,
        integrationId: row.id,
      });
      if (row.is_legacy_active !== false && row.legacy_webhook_id) {
        await ensurePosWebhookRouteRows(client, {
          provider: row.provider,
          identifier: row.legacy_webhook_id,
          routeType: "legacy",
          tenantSchemaName: schemaName,
          integrationId: row.id,
        });
      }
    }
  }
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  const tenantSchemasResult = await client.query(
    `
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name LIKE $1
      ORDER BY schema_name
    `,
    [TENANT_SCHEMA_PATTERN],
  );

  const publicTablesResult = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> ALL($1::text[])
    ORDER BY table_name
  `, [[...SKIPPED_TABLES]]);

  const publicTables = publicTablesResult.rows.map((row) => row.table_name);
  const syncedSchemas = [];
  const tenantSchemas = tenantSchemasResult.rows.map((row) => row.schema_name);

  for (const schemaName of tenantSchemas) {
    await client.query("SELECT set_config('search_path', $1, false)", [tenantSearchPath(schemaName)]);
    await syncTenantSchema(client, schemaName, publicTables);
    syncedSchemas.push(schemaName);
  }

  await client.query("SELECT set_config('search_path', 'public', false)");
  await backfillPosWebhookRoutes(client, tenantSchemas);

  console.log(JSON.stringify({
    syncedSchemas,
    publicTablesChecked: publicTables.length,
  }, null, 2));
} finally {
  await client.end();
}
