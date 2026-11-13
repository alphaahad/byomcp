import "server-only";
/**
 * Versioned publishing. A connector serves exactly one published version over
 * MCP (connectors.current_version_id). Edits never touch what's live: "Start a
 * new draft" copies the published version into version N+1, and the MCP
 * endpoint keeps serving N until N+1 is published.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { actions, connectorVersions, connectors, credentials } from "@/server/db/schema";
import { activeToken, rotateToken } from "./tokens";

export type PublishResult = { ok: true; version: number; token?: string } | { ok: false; error: string };

async function latestVersion(connectorId: string) {
  const [v] = await db()
    .select()
    .from(connectorVersions)
    .where(eq(connectorVersions.connectorId, connectorId))
    .orderBy(desc(connectorVersions.version))
    .limit(1);
  return v ?? null;
}

/** Publish the latest draft. Issues a token on first publish (returned once). */
export async function publishLatest(connectorId: string): Promise<PublishResult> {
  if (!z.uuid().safeParse(connectorId).success) return { ok: false, error: "This app wasn't found." };
  const d = db();
  const [connector] = await d.select().from(connectors).where(eq(connectors.id, connectorId)).limit(1);
  if (!connector) return { ok: false, error: "This app wasn't found." };
  const draft = await latestVersion(connectorId);
  if (!draft || draft.status !== "draft") return { ok: false, error: "There's nothing new to publish. Start a new draft to make changes." };

  if (!connector.baseUrl || !connector.authType) return { ok: false, error: "Connect your account before publishing." };
  if (connector.authType !== "none") {
    const [cred] = await d.select({ status: credentials.status }).from(credentials).where(eq(credentials.connectorId, connectorId)).limit(1);
    if (!cred) return { ok: false, error: "Connect your account before publishing." };
    if (cred.status === "needs_reconnect") return { ok: false, error: "The app rejected your saved key. Reconnect your account, then publish." };
  }
  const [{ on }] = await d
    .select({ on: sql<number>`count(*)::int` })
    .from(actions)
    .where(and(eq(actions.versionId, draft.id), eq(actions.enabled, true)));
  if (on === 0) return { ok: false, error: "Turn on at least one action, so your AI employee has something to use." };

  const now = new Date();
  await d.batch([
    d
      .update(connectorVersions)
      .set({ status: "superseded" })
      .where(and(eq(connectorVersions.connectorId, connectorId), eq(connectorVersions.status, "published"))),
    d.update(connectorVersions).set({ status: "published", publishedAt: now }).where(eq(connectorVersions.id, draft.id)),
    d.update(connectors).set({ status: "published", currentVersionId: draft.id }).where(eq(connectors.id, connectorId)),
  ]);

  const existing = await activeToken(connectorId);
  if (existing) return { ok: true, version: draft.version };
  const { token } = await rotateToken(connectorId);
  return { ok: true, version: draft.version, token };
}

/** Copy the published version into a new draft (N+1) so it can be edited safely. */
export async function startNewDraft(connectorId: string): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  if (!z.uuid().safeParse(connectorId).success) return { ok: false, error: "This app wasn't found." };
  const d = db();
  const latest = await latestVersion(connectorId);
  if (!latest) return { ok: false, error: "This app has no versions yet." };
  if (latest.status === "draft") return { ok: true, version: latest.version };

  const rows = await d.select().from(actions).where(eq(actions.versionId, latest.id));
  const [created] = await d
    .insert(connectorVersions)
    .values({
      connectorId,
      version: latest.version + 1,
      status: "draft",
      sourceType: latest.sourceType,
      sourceRef: latest.sourceRef,
      detected: latest.detected,
      skipped: latest.skipped,
      llmProvider: latest.llmProvider,
      llmModel: latest.llmModel,
      // The AI cost was paid on the original import; a copy costs nothing.
      importCostUsd: "0",
    })
    .returning({ id: connectorVersions.id, version: connectorVersions.version });
  if (rows.length) {
    await d.insert(actions).values(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      rows.map(({ id: _id, createdAt: _c, versionId: _v, ...rest }) => ({ ...rest, versionId: created.id })),
    );
  }
  return { ok: true, version: created.version };
}

export async function listVersions(connectorId: string) {
  const d = db();
  return d
    .select({
      id: connectorVersions.id,
      version: connectorVersions.version,
      status: connectorVersions.status,
      publishedAt: connectorVersions.publishedAt,
      createdAt: connectorVersions.createdAt,
      // Explicit names: inside a subquery Drizzle renders columns unqualified, and "id" would bind to actions.id.
      tools: sql<number>`(select count(*)::int from "actions" a where a."version_id" = "connector_versions"."id" and a."enabled")`,
    })
    .from(connectorVersions)
    .where(eq(connectorVersions.connectorId, connectorId))
    .orderBy(desc(connectorVersions.version));
}

export async function setUrlTokenAllowed(connectorId: string, allowed: boolean) {
  await db().update(connectors).set({ allowUrlToken: allowed }).where(eq(connectors.id, connectorId));
}
