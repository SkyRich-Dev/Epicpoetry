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
await client.query(`alter role "${username}" in database "${database}" set search_path to epicpoetry, public`);
await client.query(`alter database "${database}" set search_path to epicpoetry, public`);

console.log(JSON.stringify({ database, username, schema: "epicpoetry" }, null, 2));

await client.end();
