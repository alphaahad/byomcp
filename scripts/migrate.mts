/**
 * Apply SQL migrations in ./drizzle over Neon's HTTP driver.
 * Why not `drizzle-kit migrate`: it picks Neon's WebSocket driver, which hangs
 * from this machine. This uses the same migrations table, so both stay compatible.
 *
 *   npm run db:migrate
 */
import { existsSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

if (!process.env.DATABASE_URL && !process.env.DATABASE_URL_UNPOOLED && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL (or DATABASE_URL_UNPOOLED) in .env.local first.");
  process.exit(1);
}

await migrate(drizzle({ client: neon(url) }), { migrationsFolder: "./drizzle" });
console.log("Migrations applied.");
