import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { connectors } from "@/server/db/schema";
import { AppNameSchema } from "@/lib/app-name";

/**
 * Rename an app. Display only: the MCP address uses the app's ID, so
 * connected AI employees keep working; the MCP server name follows the new name.
 */
export async function renameConnector(connectorId: string, name: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  if (!z.uuid().safeParse(connectorId).success) return { ok: false, error: "This app wasn't found." };
  const parsed = AppNameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That name isn't valid." };
  const rows = await db().update(connectors).set({ name: parsed.data }).where(eq(connectors.id, connectorId)).returning({ id: connectors.id });
  if (rows.length === 0) return { ok: false, error: "This app wasn't found." };
  return { ok: true, name: parsed.data };
}
