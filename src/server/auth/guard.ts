import "server-only";
/**
 * The workspace boundary. Every page and server action goes through here:
 * - currentWorkspace(): the signed-in, not-revoked workspace (or null).
 * - requireWorkspace(): same, or redirect to /login.
 * - ownedConnector(id): the app if it belongs to the signed-in workspace, else null.
 *   Everything else (versions, actions, calls, approvals, jobs) is reached through
 *   an app, so checking the app is checking the workspace.
 */
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { z } from "zod";
import { db } from "@/server/db";
import { actions, approvals, connectorVersions, connectors, importJobs } from "@/server/db/schema";
import { env } from "@/server/env";
import { activeWorkspace, type Workspace } from "@/server/workspaces/workspaces";
import { SESSION_COOKIE, verifySessionValue } from "./session";

const isUuid = (id: unknown): id is string => typeof id === "string" && z.uuid().safeParse(id).success;

/** Cached per request: one cookie check and one database read. */
export const currentWorkspace = cache(async (): Promise<Workspace | null> => {
  await connection(); // request-time only (reads the cookie and the clock)
  const { CREDENTIALS_ENCRYPTION_KEY, APP_PASSCODE } = env();
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  const workspaceId = verifySessionValue(value, { encryptionKey: CREDENTIALS_ENCRYPTION_KEY, passcode: APP_PASSCODE });
  return workspaceId ? activeWorkspace(workspaceId) : null;
});

export async function requireWorkspace(): Promise<Workspace> {
  const w = await currentWorkspace();
  if (!w) redirect("/login");
  return w;
}

/** Call at the top of every server action and private route handler. */
export async function requireSession(): Promise<Workspace> {
  return requireWorkspace();
}

export async function requireOwner(): Promise<Workspace> {
  const w = await requireWorkspace();
  if (!w.isOwner) redirect("/");
  return w;
}

/** The app, only if it belongs to the signed-in workspace. */
export const ownedConnector = cache(async (connectorId: unknown) => {
  if (!isUuid(connectorId)) return null;
  const w = await currentWorkspace();
  if (!w) return null;
  const [c] = await db()
    .select()
    .from(connectors)
    .where(and(eq(connectors.id, connectorId), eq(connectors.workspaceId, w.id)))
    .limit(1);
  return c ?? null;
});

/** True if the action's app belongs to the signed-in workspace. */
export async function ownsAction(actionId: unknown): Promise<boolean> {
  if (!isUuid(actionId)) return false;
  const [r] = await db()
    .select({ connectorId: connectorVersions.connectorId })
    .from(actions)
    .innerJoin(connectorVersions, eq(actions.versionId, connectorVersions.id))
    .where(eq(actions.id, actionId))
    .limit(1);
  return !!r && !!(await ownedConnector(r.connectorId));
}

export async function ownsVersion(versionId: unknown): Promise<boolean> {
  if (!isUuid(versionId)) return false;
  const [r] = await db().select({ connectorId: connectorVersions.connectorId }).from(connectorVersions).where(eq(connectorVersions.id, versionId)).limit(1);
  return !!r && !!(await ownedConnector(r.connectorId));
}

export async function ownsApproval(approvalId: unknown): Promise<boolean> {
  if (!isUuid(approvalId)) return false;
  const [r] = await db().select({ connectorId: approvals.connectorId }).from(approvals).where(eq(approvals.id, approvalId)).limit(1);
  return !!r && !!(await ownedConnector(r.connectorId));
}

export async function ownsImportJob(jobId: unknown): Promise<boolean> {
  if (!isUuid(jobId)) return false;
  const [r] = await db().select({ connectorId: importJobs.connectorId }).from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
  return !!r && !!(await ownedConnector(r.connectorId));
}
