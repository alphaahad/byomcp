import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "@/server/env";
import * as schema from "./schema";

/**
 * Neon over HTTP: one round trip per query, no pooled connections to leak on
 * serverless. Multi-statement writes use db.batch() (runs as one transaction).
 */
function create() {
  return drizzle({ client: neon(env().DATABASE_URL), schema });
}

let instance: ReturnType<typeof create> | undefined;

export function db() {
  instance ??= create();
  return instance;
}

export { schema };
