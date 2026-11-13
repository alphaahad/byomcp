import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { actions, connectorVersions, connectors } from "@/server/db/schema";

const isUuid = (id: string) => z.uuid().safeParse(id).success;

/** Apps in one workspace, newest first. */
export async function listConnectors(workspaceId: string) {
  return db().select().from(connectors).where(eq(connectors.workspaceId, workspaceId)).orderBy(desc(connectors.createdAt));
}

/** The connector, its newest version, and that version's actions (grouped order). Null if not found. */
export async function getConnectorForReview(id: string) {
  if (!isUuid(id)) return null;
  const d = db();
  const [connector] = await d.select().from(connectors).where(eq(connectors.id, id)).limit(1);
  if (!connector) return null;
  const [version] = await d
    .select()
    .from(connectorVersions)
    .where(eq(connectorVersions.connectorId, id))
    .orderBy(desc(connectorVersions.version))
    .limit(1);
  if (!version) return { connector, version: null, actions: [] };
  const rows = await d
    .select()
    .from(actions)
    .where(eq(actions.versionId, version.id))
    .orderBy(asc(actions.resource), asc(actions.title));
  return { connector, version, actions: rows };
}
