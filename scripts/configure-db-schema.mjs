import path from "node:path";
import { createRequire } from "node:module";

process.loadEnvFile(path.resolve(process.cwd(), ".env"));

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

const url = new URL(databaseUrl);
const username = decodeURIComponent(url.username);
const database = url.pathname.replace(/^\//, "");

const requireFromDb = createRequire(path.resolve(process.cwd(), "lib/db/package.json"));
const { Client } = requireFromDb("pg");

const adminUrl = new URL(databaseUrl);
adminUrl.searchParams.delete("options");

const client = new Client({ connectionString: adminUrl.toString() });
await client.connect();

await client.query('create schema if not exists epicpoetry');

const tablesResult = await client.query(`
  select table_name
  from information_schema.tables
  where table_schema = 'epicpoetry' and table_type = 'BASE TABLE'
  order by table_name
`);

for (const { table_name: tableName } of tablesResult.rows) {
  await client.query(`alter table epicpoetry."${tableName}" set schema public`);
}

const sequencesResult = await client.query(`
  select sequence_name
  from information_schema.sequences
  where sequence_schema = 'epicpoetry'
  order by sequence_name
`);

for (const { sequence_name: sequenceName } of sequencesResult.rows) {
  await client.query(`alter sequence epicpoetry."${sequenceName}" set schema public`);
}

await client.query(`alter role "${username}" in database "${database}" set search_path to public, epicpoetry`);
await client.query(`alter database "${database}" set search_path to public, epicpoetry`);

console.log(JSON.stringify({ database, username, schema: "public", fallbackSchema: "epicpoetry" }, null, 2));

await client.end();
