"use server";

import { z } from "zod";
import { ownedConnector, requireSession } from "@/server/auth/guard";
import { publishLatest, setUrlTokenAllowed, startNewDraft } from "@/server/publish/publish";
import { rotateToken } from "@/server/publish/tokens";

const Id = z.uuid();

const NOT_FOUND = { ok: false as const, error: "This app wasn't found." };

export async function publishAction(connectorId: string) {
  await requireSession();
  if (!(await ownedConnector(connectorId))) return NOT_FOUND;
  return publishLatest(connectorId);
}

export async function startDraftAction(connectorId: string) {
  await requireSession();
  if (!(await ownedConnector(connectorId))) return NOT_FOUND;
  return startNewDraft(connectorId);
}

/** Returns the new token ONCE; the old one stops working immediately. */
export async function rotateTokenAction(connectorId: string): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  await requireSession();
  if (!Id.safeParse(connectorId).success || !(await ownedConnector(connectorId))) return NOT_FOUND;
  const { token } = await rotateToken(connectorId);
  return { ok: true, token };
}

export async function setUrlTokenAction(connectorId: string, allowed: boolean): Promise<{ ok: boolean }> {
  await requireSession();
  if (!Id.safeParse(connectorId).success || !(await ownedConnector(connectorId))) return { ok: false };
  await setUrlTokenAllowed(connectorId, allowed);
  return { ok: true };
}
