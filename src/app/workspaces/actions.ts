"use server";

import { z } from "zod";
import { AppNameSchema } from "@/lib/app-name";
import { requireOwner } from "@/server/auth/guard";
import { setWorkspaceLabel, setWorkspaceRevoked } from "@/server/workspaces/workspaces";

type Result = { ok: true } | { ok: false; error: string };

export async function renameWorkspaceAction(workspaceId: string, label: string): Promise<Result> {
  await requireOwner();
  if (!z.uuid().safeParse(workspaceId).success) return { ok: false, error: "That workspace wasn't found." };
  const parsed = AppNameSchema.safeParse(label);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message.replace("app", "workspace") ?? "That name isn't valid." };
  await setWorkspaceLabel(workspaceId, parsed.data);
  return { ok: true };
}

export async function setRevokedAction(workspaceId: string, revoked: boolean): Promise<Result> {
  await requireOwner();
  if (!z.uuid().safeParse(workspaceId).success) return { ok: false, error: "That workspace wasn't found." };
  await setWorkspaceRevoked(workspaceId, revoked === true);
  return { ok: true };
}
