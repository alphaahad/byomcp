import "server-only";
/**
 * Approvals: a person decides before a write runs (SPEC 6.3).
 *  - approve = claim the row atomically (pending → approved) and only then run
 *    the call, so double-clicks and two tabs can't run it twice
 *  - reject = nothing is sent to the app
 *  - pending requests expire after 24 h, so stale intent is never acted on
 * The outcome is written onto the original tool_calls row (one row per call).
 */
import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { actions, approvals, connectors, toolCalls } from "@/server/db/schema";
import { executeNow, type ExecutedRun } from "@/server/runtime/tool-call";

export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
const expiryCutoff = () => new Date(Date.now() - APPROVAL_TTL_MS);
export const shortId = (id: string) => `apr_${id.slice(0, 8)}`;

/** Lazily expire stale pending requests (cheap, idempotent). */
export async function expireStale(connectorId?: string) {
  const d = db();
  const stale = await d
    .update(approvals)
    .set({ status: "expired", decidedAt: new Date(), decidedBy: "system" })
    .where(
      and(eq(approvals.status, "pending"), lt(approvals.createdAt, expiryCutoff()), connectorId ? eq(approvals.connectorId, connectorId) : undefined),
    )
    .returning({ toolCallId: approvals.toolCallId });
  for (const s of stale) {
    await d
      .update(toolCalls)
      .set({ status: "rejected", failureReason: "Expired: nobody approved it within 24 hours." })
      .where(eq(toolCalls.id, s.toolCallId));
  }
}

export type ApprovalRow = {
  id: string;
  shortId: string;
  status: "pending" | "approved" | "rejected" | "expired";
  summary: string;
  input: Record<string, unknown>;
  createdAt: Date;
  decidedAt: Date | null;
  connectorId: string;
  connectorName: string;
  actionTitle: string | null;
  actionKey: string | null;
  risk: "read" | "write" | "destructive" | null;
  result: { status: string; httpStatus: number | null; reason: string | null; preview: string | null } | null;
};

export async function listApprovals(opts: { workspaceId: string; pending: boolean; limit?: number }): Promise<ApprovalRow[]> {
  await expireStale();
  const rows = await db()
    .select({ a: approvals, c: { name: connectors.name }, act: { title: actions.title, key: actions.key, risk: actions.risk }, call: toolCalls })
    .from(approvals)
    .innerJoin(connectors, eq(approvals.connectorId, connectors.id))
    .leftJoin(actions, eq(approvals.actionId, actions.id))
    .innerJoin(toolCalls, eq(approvals.toolCallId, toolCalls.id))
    .where(
      and(
        eq(connectors.workspaceId, opts.workspaceId),
        opts.pending ? eq(approvals.status, "pending") : sql`${approvals.status} <> 'pending'`,
      ),
    )
    .orderBy(opts.pending ? approvals.createdAt : desc(approvals.decidedAt))
    .limit(opts.limit ?? 50);
  return rows.map(({ a, c, act, call }) => ({
    id: a.id,
    shortId: shortId(a.id),
    status: a.status,
    summary: a.summary,
    input: a.input,
    createdAt: a.createdAt,
    decidedAt: a.decidedAt,
    connectorId: a.connectorId,
    connectorName: c.name,
    actionTitle: act?.title ?? null,
    actionKey: act?.key ?? call.actionKey,
    risk: act?.risk ?? null,
    result:
      a.status === "approved"
        ? { status: call.status, httpStatus: call.httpStatus, reason: call.failureReason, preview: call.responsePreview }
        : null,
  }));
}

export async function countPending(workspaceId: string): Promise<number> {
  const [{ n }] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(approvals)
    .innerJoin(connectors, eq(approvals.connectorId, connectors.id))
    .where(and(eq(connectors.workspaceId, workspaceId), eq(approvals.status, "pending"), gt(approvals.createdAt, expiryCutoff())));
  return n;
}

/** Pending (not expired) requests per connector, for the home list. */
export async function pendingByConnector(workspaceId: string): Promise<Map<string, number>> {
  const rows = await db()
    .select({ connectorId: approvals.connectorId, n: sql<number>`count(*)::int` })
    .from(approvals)
    .innerJoin(connectors, eq(approvals.connectorId, connectors.id))
    .where(and(eq(connectors.workspaceId, workspaceId), eq(approvals.status, "pending"), gt(approvals.createdAt, expiryCutoff())))
    .groupBy(approvals.connectorId);
  return new Map(rows.map((r) => [r.connectorId, r.n]));
}

export type DecisionResult = { ok: true; run?: ExecutedRun } | { ok: false; error: string };

/** Approve and run exactly once. */
export async function approve(approvalId: string): Promise<DecisionResult> {
  if (!z.uuid().safeParse(approvalId).success) return { ok: false, error: "That request wasn't found." };
  const d = db();
  // The atomic claim: only one caller can move it out of "pending".
  const [claimed] = await d
    .update(approvals)
    .set({ status: "approved", decidedAt: new Date(), decidedBy: "workspace" })
    .where(and(eq(approvals.id, approvalId), eq(approvals.status, "pending"), gt(approvals.createdAt, expiryCutoff())))
    .returning();
  if (!claimed) return { ok: false, error: await whyNot(approvalId) };

  const [found] = await d
    .select({ action: actions, connector: connectors })
    .from(actions)
    .innerJoin(connectors, eq(connectors.id, claimed.connectorId))
    .where(eq(actions.id, claimed.actionId ?? "00000000-0000-0000-0000-000000000000"))
    .limit(1);
  if (!found) {
    await d.update(toolCalls).set({ status: "request_error", failureReason: "The action no longer exists." }).where(eq(toolCalls.id, claimed.toolCallId));
    return { ok: false, error: "That action no longer exists, so nothing was sent." };
  }

  const { action, connector } = found;
  const run = await executeNow(
    { id: connector.id, name: connector.name, baseUrl: connector.baseUrl, authType: connector.authType, authConfig: connector.authConfig ?? null },
    { ...action, successCheck: action.successCheck },
    claimed.input,
  );
  await d.batch([
    d
      .update(toolCalls)
      .set({
        status: run.status,
        httpStatus: run.httpStatus,
        failureReason: run.reason,
        durationMs: run.durationMs,
        attempts: run.attempts,
        responsePreview: run.preview,
      })
      .where(eq(toolCalls.id, claimed.toolCallId)),
    d.update(approvals).set({ resultToolCallId: claimed.toolCallId }).where(eq(approvals.id, claimed.id)),
  ]);
  return { ok: true, run };
}

export async function reject(approvalId: string): Promise<DecisionResult> {
  if (!z.uuid().safeParse(approvalId).success) return { ok: false, error: "That request wasn't found." };
  const d = db();
  const [claimed] = await d
    .update(approvals)
    .set({ status: "rejected", decidedAt: new Date(), decidedBy: "workspace" })
    .where(and(eq(approvals.id, approvalId), eq(approvals.status, "pending")))
    .returning();
  if (!claimed) return { ok: false, error: await whyNot(approvalId) };
  await d.update(toolCalls).set({ status: "rejected", failureReason: "Rejected by a person in BYOMCP." }).where(eq(toolCalls.id, claimed.toolCallId));
  return { ok: true };
}

async function whyNot(approvalId: string): Promise<string> {
  await expireStale();
  const [row] = await db().select({ status: approvals.status }).from(approvals).where(eq(approvals.id, approvalId)).limit(1);
  if (!row) return "That request wasn't found.";
  if (row.status === "expired") return "That request expired (nobody approved it within 24 hours), so nothing was sent.";
  return `That request was already ${row.status}.`;
}

/** For the check_approval MCP tool: only this connector's requests, by "apr_xxxxxxxx". */
export async function approvalStatusForConnector(connectorId: string, requestId: string) {
  const hex = requestId.trim().toLowerCase().replace(/^apr_/, "");
  if (!/^[0-9a-f]{8}$/.test(hex)) return null;
  await expireStale(connectorId);
  const [row] = await db()
    .select({ a: approvals, call: toolCalls })
    .from(approvals)
    .innerJoin(toolCalls, eq(approvals.toolCallId, toolCalls.id))
    .where(and(eq(approvals.connectorId, connectorId), sql`${approvals.id}::text like ${hex + "%"}`))
    .limit(1);
  if (!row) return null;
  return {
    status: row.a.status,
    summary: row.a.summary,
    decidedAt: row.a.decidedAt,
    result:
      row.a.status === "approved"
        ? { status: row.call.status, httpStatus: row.call.httpStatus, reason: row.call.failureReason, preview: row.call.responsePreview }
        : null,
  };
}
