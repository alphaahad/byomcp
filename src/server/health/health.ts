import "server-only";
/**
 * Connector health (SPEC 5 #9): status, last success, failures by reason,
 * reconnect prompt. The status rule is a pure function so it's testable.
 */
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { connectors, credentials, toolCalls } from "@/server/db/schema";

export type HealthStatus = "needs_reconnect" | "failing" | "healthy" | "no_calls" | "not_connected";

/** Statuses that say something about the app/connection (not the model's input, not human decisions). */
export const OUTCOME_STATUSES = ["success", "empty_or_invalid", "auth_failed", "transient_failed", "request_error"] as const;
export const FAILURE_STATUSES = ["empty_or_invalid", "auth_failed", "transient_failed", "request_error"] as const;

export function computeHealth(input: {
  connected: boolean;
  credentialStatus: "active" | "needs_reconnect" | null;
  recentOutcomes: string[]; // newest first, OUTCOME_STATUSES only
}): HealthStatus {
  if (!input.connected) return "not_connected";
  if (input.credentialStatus === "needs_reconnect") return "needs_reconnect";
  if (input.recentOutcomes.length === 0) return "no_calls";
  const last5 = input.recentOutcomes.slice(0, 5);
  const failures = last5.filter((s) => (FAILURE_STATUSES as readonly string[]).includes(s)).length;
  if (failures >= 3) return "failing";
  return "healthy";
}

export const HEALTH_LABEL: Record<HealthStatus, string> = {
  needs_reconnect: "Needs reconnect",
  failing: "Failing",
  healthy: "Healthy",
  no_calls: "No calls yet",
  not_connected: "Not connected",
};

export const REASON_LABEL: Record<string, string> = {
  success: "Worked",
  empty_or_invalid: "Answered, but not with what we expected",
  auth_failed: "Key rejected",
  transient_failed: "App didn't respond properly",
  request_error: "Request was wrong",
  validation_error: "Bad input from the AI",
  pending_approval: "Waiting for approval",
  rejected: "Rejected or expired",
};

async function connectionState(connectorId: string) {
  const d = db();
  const [c] = await d.select({ baseUrl: connectors.baseUrl, authType: connectors.authType }).from(connectors).where(eq(connectors.id, connectorId)).limit(1);
  const [cred] = await d.select({ status: credentials.status, lastVerifiedAt: credentials.lastVerifiedAt }).from(credentials).where(eq(credentials.connectorId, connectorId)).limit(1);
  const connected = !!c?.baseUrl && !!c.authType && (c.authType === "none" || !!cred);
  return { connected, credentialStatus: cred?.status ?? null, lastVerifiedAt: cred?.lastVerifiedAt ?? null };
}

export async function healthSummary(connectorId: string): Promise<HealthStatus> {
  const state = await connectionState(connectorId);
  const recent = await db()
    .select({ status: toolCalls.status })
    .from(toolCalls)
    .where(and(eq(toolCalls.connectorId, connectorId), inArray(toolCalls.status, [...OUTCOME_STATUSES])))
    .orderBy(desc(toolCalls.createdAt))
    .limit(5);
  return computeHealth({ ...state, recentOutcomes: recent.map((r) => r.status) });
}

export async function healthDetail(connectorId: string) {
  const d = db();
  const state = await connectionState(connectorId);
  const day = new Date(Date.now() - 24 * 3600 * 1000);
  const week = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  const [recent, byStatus, lastSuccess, lastFailure, perTool] = await Promise.all([
    d
      .select({ status: toolCalls.status })
      .from(toolCalls)
      .where(and(eq(toolCalls.connectorId, connectorId), inArray(toolCalls.status, [...OUTCOME_STATUSES])))
      .orderBy(desc(toolCalls.createdAt))
      .limit(5),
    d
      .select({
        status: toolCalls.status,
        day: sql<number>`count(*) filter (where ${toolCalls.createdAt} >= ${day})::int`,
        week: sql<number>`count(*)::int`,
      })
      .from(toolCalls)
      .where(and(eq(toolCalls.connectorId, connectorId), gte(toolCalls.createdAt, week)))
      .groupBy(toolCalls.status),
    d
      .select({ at: toolCalls.createdAt, key: toolCalls.actionKey })
      .from(toolCalls)
      .where(and(eq(toolCalls.connectorId, connectorId), eq(toolCalls.status, "success")))
      .orderBy(desc(toolCalls.createdAt))
      .limit(1),
    d
      .select({ at: toolCalls.createdAt, key: toolCalls.actionKey, status: toolCalls.status, reason: toolCalls.failureReason })
      .from(toolCalls)
      .where(and(eq(toolCalls.connectorId, connectorId), inArray(toolCalls.status, [...FAILURE_STATUSES])))
      .orderBy(desc(toolCalls.createdAt))
      .limit(1),
    d
      .selectDistinctOn([toolCalls.actionKey], {
        key: toolCalls.actionKey,
        status: toolCalls.status,
        at: toolCalls.createdAt,
        httpStatus: toolCalls.httpStatus,
      })
      .from(toolCalls)
      .where(and(eq(toolCalls.connectorId, connectorId), inArray(toolCalls.status, [...OUTCOME_STATUSES])))
      .orderBy(toolCalls.actionKey, desc(toolCalls.createdAt)),
  ]);

  const status = computeHealth({ ...state, recentOutcomes: recent.map((r) => r.status) });
  const count = (key: "day" | "week", statuses?: readonly string[]) =>
    byStatus.filter((r) => !statuses || statuses.includes(r.status)).reduce((n, r) => n + r[key], 0);
  const outcomes7 = count("week", OUTCOME_STATUSES);
  const successes7 = count("week", ["success"]);

  return {
    status,
    credentialStatus: state.credentialStatus,
    lastVerifiedAt: state.lastVerifiedAt,
    calls24h: count("day"),
    calls7d: count("week"),
    successRate7d: outcomes7 ? successes7 / outcomes7 : null,
    byStatus7d: byStatus.map((r) => ({ status: r.status, count: r.week })).sort((a, b) => b.count - a.count),
    lastSuccess: lastSuccess[0] ?? null,
    lastFailure: lastFailure[0] ?? null,
    perTool: perTool.sort((a, b) => b.at.getTime() - a.at.getTime()),
  };
}

export type CallLogRow = typeof toolCalls.$inferSelect;

export async function listCalls(connectorId: string, opts: { status?: string; before?: Date; limit?: number } = {}): Promise<CallLogRow[]> {
  const validStatus = opts.status && Object.keys(REASON_LABEL).includes(opts.status) ? opts.status : undefined;
  return db()
    .select()
    .from(toolCalls)
    .where(
      and(
        eq(toolCalls.connectorId, connectorId),
        validStatus ? eq(toolCalls.status, validStatus as CallLogRow["status"]) : undefined,
        opts.before ? lt(toolCalls.createdAt, opts.before) : undefined,
      ),
    )
    .orderBy(desc(toolCalls.createdAt))
    .limit(opts.limit ?? 50);
}
