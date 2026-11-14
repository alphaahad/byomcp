import "server-only";
/**
 * Workspaces: one per passcode. Apps belong to exactly one workspace; every
 * other table is reached through an app, so scoping apps scopes everything.
 */
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { appRequests, connectorVersions, connectors, signIns, toolCalls, workspaces } from "@/server/db/schema";
import { hashPasscode, passcodeMatches } from "@/server/auth/session";

export type Workspace = { id: string; label: string; isOwner: boolean };

/** AI imports a guest workspace can start per rolling 24 hours (they share one Gemini key). */
export const GUEST_AI_IMPORTS_PER_DAY = 20;
/** Apps a guest workspace can hold (keeps a shared demo database bounded). */
export const GUEST_MAX_APPS = 25;

export async function appCount(workspaceId: string): Promise<number> {
  const [{ n }] = await db().select({ n: sql<number>`count(*)::int` }).from(connectors).where(eq(connectors.workspaceId, workspaceId));
  return n;
}

export const TOO_MANY_APPS = `This workspace has ${GUEST_MAX_APPS} apps, the most a guest workspace can hold. Ask whoever shared BYOMCP with you if you need more.`;

export async function ownerWorkspace(): Promise<Workspace> {
  const [w] = await db()
    .select({ id: workspaces.id, label: workspaces.label, isOwner: workspaces.isOwner })
    .from(workspaces)
    .where(eq(workspaces.isOwner, true))
    .limit(1);
  if (!w) throw new Error("No owner workspace. Run the database migrations.");
  return w;
}

/** Which workspace a passcode opens: the owner's (APP_PASSCODE) or a guest's (by hash). Null if none, or revoked. */
export async function workspaceForPasscode(attempt: string, ownerPasscode: string): Promise<Workspace | null> {
  if (!attempt.trim()) return null;
  if (passcodeMatches(attempt, ownerPasscode)) return ownerWorkspace();
  const [w] = await db()
    .select({ id: workspaces.id, label: workspaces.label, isOwner: workspaces.isOwner })
    .from(workspaces)
    .where(and(eq(workspaces.passcodeHash, hashPasscode(attempt)), isNull(workspaces.revokedAt)))
    .limit(1);
  return w ?? null;
}

export async function recordSignIn(workspaceId: string) {
  const d = db();
  await d.batch([
    d.update(workspaces).set({ lastSignInAt: new Date() }).where(eq(workspaces.id, workspaceId)),
    d.insert(signIns).values({ workspaceId }),
  ]);
}

/** A live (not revoked) workspace by id. */
export async function activeWorkspace(workspaceId: string): Promise<Workspace | null> {
  const [w] = await db()
    .select({ id: workspaces.id, label: workspaces.label, isOwner: workspaces.isOwner })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.revokedAt)))
    .limit(1);
  return w ?? null;
}

/** AI imports started by this workspace in the last 24 hours. */
export async function aiImportsLastDay(workspaceId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [{ n }] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(connectorVersions)
    .innerJoin(connectors, eq(connectorVersions.connectorId, connectors.id))
    .where(
      and(
        eq(connectors.workspaceId, workspaceId),
        inArray(connectorVersions.sourceType, ["docs_url", "text"]),
        gt(connectorVersions.createdAt, since),
      ),
    );
  return n;
}

/** Owner view: every workspace with its usage. (The outer id is written out: inside a subquery Drizzle leaves columns unqualified.) */
export async function listWorkspacesWithStats() {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  return db()
    .select({
      id: workspaces.id,
      label: workspaces.label,
      isOwner: workspaces.isOwner,
      lastSignInAt: workspaces.lastSignInAt,
      revokedAt: workspaces.revokedAt,
      createdAt: workspaces.createdAt,
      apps: sql<number>`(select count(*)::int from ${connectors} c where c.workspace_id = "workspaces"."id")`,
      published: sql<number>`(select count(*)::int from ${connectors} c where c.workspace_id = "workspaces"."id" and c.status = 'published')`,
      calls7d: sql<number>`(select count(*)::int from ${toolCalls} t join ${connectors} c on c.id = t.connector_id where c.workspace_id = "workspaces"."id" and t.created_at >= ${since})`,
      aiImports: sql<number>`(select count(*)::int from ${connectorVersions} v join ${connectors} c on c.id = v.connector_id where c.workspace_id = "workspaces"."id" and v.source_type in ('docs_url','text'))`,
      aiCostUsd: sql<string>`((select coalesce(sum(v.import_cost_usd), 0) from ${connectorVersions} v join ${connectors} c on c.id = v.connector_id where c.workspace_id = "workspaces"."id") + (select coalesce(sum(u.cost_usd), 0) from "chat_usage" u where u.workspace_id = "workspaces"."id"))`,
      chatMessages: sql<number>`(select count(*)::int from "chat_usage" u where u.workspace_id = "workspaces"."id")`,
    })
    .from(workspaces)
    .orderBy(desc(workspaces.isOwner), workspaces.createdAt);
}

export async function setWorkspaceLabel(workspaceId: string, label: string) {
  await db().update(workspaces).set({ label }).where(eq(workspaces.id, workspaceId));
}

/** Revoke or restore a guest workspace. The owner workspace can't be revoked (change APP_PASSCODE instead). */
export async function setWorkspaceRevoked(workspaceId: string, revoked: boolean) {
  await db()
    .update(workspaces)
    .set({ revokedAt: revoked ? new Date() : null })
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.isOwner, false)));
}

/** Save a "please add this app" request (max 5 per workspace per day, to keep it a signal, not a sink). */
export async function requestApp(workspaceId: string, appName: string, note: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [{ n }] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(appRequests)
    .where(and(eq(appRequests.workspaceId, workspaceId), gt(appRequests.createdAt, since)));
  if (n >= 5) return { ok: false, error: "Thanks! You've sent 5 requests today, which is plenty for us to go on." };
  await db().insert(appRequests).values({ workspaceId, appName, note });
  return { ok: true };
}

/** Owner view: the latest app requests, with who asked. */
export async function listAppRequests(limit = 50) {
  return db()
    .select({ id: appRequests.id, appName: appRequests.appName, note: appRequests.note, createdAt: appRequests.createdAt, workspace: workspaces.label })
    .from(appRequests)
    .innerJoin(workspaces, eq(appRequests.workspaceId, workspaces.id))
    .orderBy(desc(appRequests.createdAt))
    .limit(limit);
}
