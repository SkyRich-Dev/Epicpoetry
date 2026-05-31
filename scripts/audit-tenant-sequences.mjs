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

  const publicTablesResult = await client.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name <> ALL($1::text[])
      ORDER BY table_name
    `,
    [[...SKIPPED_TABLES]],
  );

  const tenantSchemas = tenantSchemasResult.rows.map((row) => row.schema_name);
  const publicTables = publicTablesResult.rows.map((row) => row.table_name);
  const auditRows = [];

  for (const schemaName of tenantSchemas) {
    for (const tableName of publicTables) {
      const serialColumns = await client.query(
        `
          SELECT column_name, column_default
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = $1
            AND column_default LIKE 'nextval(%'
        `,
        [tableName],
      );

      for (const row of serialColumns.rows) {
        const match = String(row.column_default || "").match(/nextval\('(?:public\.)?([^']+)'::regclass\)/i);
        if (!match) continue;
        const sequenceName = String(match[1]).replace(/^public\./i, "");

        const maxIdResult = await client.query(
          `SELECT COALESCE(MAX(${quoteIdent(row.column_name)}), 0) AS max_id FROM ${quoteIdent(schemaName)}.${quoteIdent(tableName)}`,
        );
        const maxId = Number(maxIdResult.rows[0]?.max_id || 0);

        let lastValue = null;
        let nextValue = null;
        try {
          const seqResult = await client.query(
            `SELECT last_value, is_called FROM ${quoteIdent(schemaName)}.${quoteIdent(sequenceName)}`,
          );
          const current = seqResult.rows[0];
          lastValue = Number(current?.last_value ?? 0);
          nextValue = current?.is_called ? lastValue + 1 : lastValue;
        } catch {
          lastValue = null;
          nextValue = null;
        }

        auditRows.push({
          schemaName,
          tableName,
          columnName: row.column_name,
          sequenceName,
          maxId,
          sequenceLastValue: lastValue,
          nextValue,
          expectedNextValue: maxId + 1,
          behind: nextValue !== null ? nextValue <= maxId : true,
        });
      }
    }
  }

  const issues = auditRows.filter((row) => row.behind);
  console.log(JSON.stringify({
    tenantSchemasChecked: tenantSchemas.length,
    sequencesChecked: auditRows.length,
    issueCount: issues.length,
    issues,
  }, null, 2));
} finally {
  await client.end();
}
