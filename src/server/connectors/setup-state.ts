import "server-only";
/**
 * Where an app is in its setup, from existing tables (no extra state to keep in sync).
 * Powers the Setup panel ("what's done, what's next") and the home cards.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { actions, connectorVersions, connectors, credentials, toolCalls, chatUsage } from "@/server/db/schema";

export type SetupStepKey = "docs" | "choose" | "connect" | "test" | "publish" | "use";

export type SetupStep = { key: SetupStepKey; label: string; hint: string; done: boolean; href: string; cta: string };

export type SetupState = {
  steps: SetupStep[];
  doneCount: number;
  next: SetupStep | null;
  toolsOn: number;
  actionsTotal: number;
  needsReconnect: boolean;
  draftHasChanges: boolean;
};

export async function getSetupState(connectorId: string): Promise<SetupState | null> {
  const d = db();
  const [c] = await d.select().from(connectors).where(eq(connectors.id, connectorId)).limit(1);
  if (!c) return null;
  const [latest] = await d
    .select({ id: connectorVersions.id, status: connectorVersions.status })
    .from(connectorVersions)
    .where(eq(connectorVersions.connectorId, connectorId))
    .orderBy(desc(connectorVersions.version))
    .limit(1);
  const versionId = latest?.id;
  const [[counts], [cred], [used]] = await Promise.all([
    versionId
      ? d
          .select({
            total: sql<number>`count(*)::int`,
            on: sql<number>`count(*) filter (where ${actions.enabled})::int`,
            tested: sql<number>`count(*) filter (where ${actions.evidence} = 'tested')::int`,
          })
          .from(actions)
          .where(eq(actions.versionId, versionId))
      : Promise.resolve([{ total: 0, on: 0, tested: 0 }]),
    d.select({ status: credentials.status }).from(credentials).where(eq(credentials.connectorId, connectorId)).limit(1),
    d
      .select({ n: sql<number>`count(*)::int` })
      .from(toolCalls)
      .where(and(eq(toolCalls.connectorId, connectorId), eq(toolCalls.source, "mcp"))),
  ]);

  const connected = !!c.baseUrl && !!c.authType && (c.authType === "none" || !!cred);
  const needsReconnect = cred?.status === "needs_reconnect";
  const published = c.status === "published" && !!c.currentVersionId;
  const base = `/apps/${connectorId}`;

  const steps: SetupStep[] = [
    { key: "docs", label: "Read the docs", hint: "We listed what the app's API can do.", done: counts.total > 0, href: `${base}/review`, cta: "See the actions" },
    { key: "choose", label: "Choose what it can do", hint: "Turn on only what your AI employee needs.", done: counts.on > 0, href: `${base}/review`, cta: "Choose actions" },
    {
      key: "connect",
      label: "Connect your account",
      hint: needsReconnect ? "The app rejected your key. Reconnect it." : "Add the key your AI employee will act with.",
      done: connected && !needsReconnect,
      href: `${base}/connect`,
      cta: needsReconnect ? "Reconnect" : "Connect",
    },
    { key: "test", label: "Test one action", hint: "Run a read for real to prove it works.", done: counts.tested > 0, href: `${base}/review?try=1`, cta: "Try an action" },
    { key: "publish", label: "Publish", hint: "Get the MCP address and token for your AI employee.", done: published, href: `${base}/published`, cta: "Publish" },
    { key: "use", label: "Use it from an AI employee", hint: "Call it from the test console, UnleashX or Claude.", done: used.n > 0, href: `${base}/console`, cta: "Open the test console" },
  ];
  return {
    steps,
    doneCount: steps.filter((s) => s.done).length,
    next: steps.find((s) => !s.done) ?? null,
    toolsOn: counts.on,
    actionsTotal: counts.total,
    needsReconnect,
    draftHasChanges: published && latest?.status === "draft",
  };
}

/** Estimated AI cost in one workspace: imports plus "Talk to it" test messages (sidebar card). */
export async function totalAiSpend(workspaceId: string): Promise<number> {
  const [r] = await db()
    .select({ usd: sql<string>`coalesce(sum(${connectorVersions.importCostUsd}), 0)` })
    .from(connectorVersions)
    .innerJoin(connectors, eq(connectorVersions.connectorId, connectors.id))
    .where(eq(connectors.workspaceId, workspaceId));
  const [c] = await db()
    .select({ usd: sql<string>`coalesce(sum(${chatUsage.costUsd}), 0)` })
    .from(chatUsage)
    .where(eq(chatUsage.workspaceId, workspaceId));
  return Number(r.usd) + Number(c.usd);
}

/** Calls and success rate over the last 7 days, per connector (home cards). */
export async function callStats7d(workspaceId: string): Promise<Map<string, { calls: number; successRate: number | null }>> {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const rows = await db()
    .select({
      connectorId: toolCalls.connectorId,
      calls: sql<number>`count(*)::int`,
      outcomes: sql<number>`count(*) filter (where ${toolCalls.status} in ('success','empty_or_invalid','auth_failed','transient_failed','request_error'))::int`,
      ok: sql<number>`count(*) filter (where ${toolCalls.status} = 'success')::int`,
    })
    .from(toolCalls)
    .innerJoin(connectors, eq(toolCalls.connectorId, connectors.id))
    .where(and(eq(connectors.workspaceId, workspaceId), sql`${toolCalls.createdAt} >= ${since}`))
    .groupBy(toolCalls.connectorId);
  return new Map(rows.map((r) => [r.connectorId, { calls: r.calls, successRate: r.outcomes ? r.ok / r.outcomes : null }]));
}

/** When an AI employee (any MCP client, the test console included) last called this app. */
export async function lastMcpCallAt(connectorId: string): Promise<Date | null> {
  const [r] = await db()
    .select({ at: sql<Date | null>`max(${toolCalls.createdAt})` })
    .from(toolCalls)
    .where(and(eq(toolCalls.connectorId, connectorId), eq(toolCalls.source, "mcp")));
  return r?.at ? new Date(r.at) : null;
}
