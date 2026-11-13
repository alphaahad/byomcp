import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next, so load .env.local ourselves (no dotenv dependency).
if (!process.env.DATABASE_URL && !process.env.DATABASE_URL_UNPOOLED && existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  // Migrations use Neon's direct (unpooled) connection when available; the app uses the pooled one.
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "" },
  strict: true,
  verbose: true,
});
