import { drizzle } from "drizzle-orm/node-postgres";
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import path from "path";
import * as schema from "./schema";

const { Pool } = pg;

const savedDbUrl = process.env.DATABASE_URL;
try { process.loadEnvFile(path.resolve(__dirname, "../../../.env")); } catch {}
if (savedDbUrl) process.env.DATABASE_URL = savedDbUrl;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const tenantSchemaContext = new AsyncLocalStorage<string>();

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function tenantSearchPath(schemaName: string): string {
  return `${quoteIdentifier(schemaName)}, public`;
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const originalPoolQuery = pool.query.bind(pool);
const originalPoolConnect = pool.connect.bind(pool);

pool.connect = (async (...args: Parameters<typeof originalPoolConnect>) => {
  const client = await originalPoolConnect(...args);
  const schemaName = tenantSchemaContext.getStore();
  if (!schemaName) return client;

  await client.query("select set_config('search_path', $1, false)", [tenantSearchPath(schemaName)]);

  const originalRelease = client.release.bind(client);
  let released = false;
  client.release = ((...releaseArgs: Parameters<typeof originalRelease>) => {
    if (released) return undefined as ReturnType<typeof originalRelease>;
    released = true;
    client.query("select set_config('search_path', 'public', false)")
      .catch(() => undefined)
      .finally(() => {
        originalRelease(...releaseArgs);
      });
    return undefined as ReturnType<typeof originalRelease>;
  }) as typeof client.release;

  return client;
}) as typeof pool.connect;

pool.query = (async (...args: Parameters<typeof originalPoolQuery>) => {
  const schemaName = tenantSchemaContext.getStore();
  if (!schemaName) return originalPoolQuery(...args);

  const client = await originalPoolConnect();
  try {
    await client.query("select set_config('search_path', $1, false)", [tenantSearchPath(schemaName)]);
    return await client.query(...args);
  } finally {
    await client.query("select set_config('search_path', 'public', false)").catch(() => undefined);
    client.release();
  }
}) as typeof pool.query;

export const db = drizzle(pool, { schema });

export * from "./schema";
