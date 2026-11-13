"use server";

import { ownedConnector, requireSession } from "@/server/auth/guard";
import { renameConnector } from "@/server/connectors/rename";

export async function renameAppAction(connectorId: string, name: string) {
  await requireSession();
  if (!(await ownedConnector(connectorId))) return { ok: false as const, error: "This app wasn't found." };
  return renameConnector(connectorId, String(name ?? ""));
}
