import crypto from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";

process.loadEnvFile(path.resolve(process.cwd(), ".env"));

const requireFromDb = createRequire(path.resolve(process.cwd(), "lib/db/package.json"));
const { Client } = requireFromDb("pg");

const username = "admin";
const password = "admin123";
const passwordHash = crypto.createHash("sha256").update(password).digest("hex");

const client = new Client({ connectionString: process.env.DATABASE_URL });

await client.connect();

const tableResult = await client.query(
  "select table_schema from information_schema.tables where table_name = 'users' order by case when table_schema = 'public' then 0 when table_schema = 'epicpoetry' then 1 else 2 end, table_schema limit 1",
);

if (tableResult.rows.length === 0) {
  throw new Error("users table not found in any schema");
}

const schema = tableResult.rows[0].table_schema;
const qualifiedUsersTable = `"${schema}"."users"`;

await client.query(
  `insert into ${qualifiedUsersTable} (username, password_hash, full_name, email, role, active)
   values ($1, $2, $3, $4, $5, $6)
   on conflict (username) do update
   set password_hash = excluded.password_hash,
       full_name = excluded.full_name,
       email = excluded.email,
       role = excluded.role,
       active = excluded.active`,
  [username, passwordHash, "Admin User", "admin@epicpoetrycafe.com", "admin", true],
);

console.log(JSON.stringify({ schema, username, password }, null, 2));

await client.end();
