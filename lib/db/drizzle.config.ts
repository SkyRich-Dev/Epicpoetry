import { defineConfig } from "drizzle-kit";
import path from "path";

process.loadEnvFile(path.resolve(__dirname, "../../.env"));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: "./src/schema/*.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
