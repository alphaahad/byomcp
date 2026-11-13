import "server-only";
/**
 * One tool call from an MCP client. Deterministic: no LLM.
 * Needs approval → pending approval row, nothing is sent to the app.
 * Otherwise → executor (credentials decrypted for this call only) → log → health.
 */
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { approvals, toolCalls } from "@/server/db/schema";
import { isOAuthConnection, loadUsableSecret, markCredential } from "@/server/connectors/connection";
import { redactInput, logCall } from "./call-log";
import { execute, type CallStatus, type ExecResult } from "./executor";

export type PublishedAction = {
  id: string;
  versionId: string;
  key: string;
  title: string;
  description?: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  params: Parameters<typeof execute>[0]["params"];
  successCheck: Parameters<typeof execute>[0]["successCheck"];
  risk: "read" | "write" | "destructive";
  requiresApproval: boolean;
};

export type ConnectorForRuntime = {
  id: string;
  name: string;
  baseUrl: string | null;
  authType: "none" | "api_key" | "bearer" | "basic" | null;
  authConfig: { in: "header" | "query" | "path"; name: string } | null;
};

export type ToolCallOutcome =
  | { kind: "pending_approval"; approvalId: string; summary: string }
  | { kind: "done"; status: CallStatus; httpStatus: number | null; reason: string | null; data: unknown; durationMs: number };

/** "Create a ticket in Helpdesk with subject “Printer broken”, priority 2". Inputs only, never secrets. */
export function approvalSummary(appName: string, title: string, input: Record<string, unknown>): string {
  const shown = Object.entries(redactInput(input))
    .filter(([, v]) => v !== null && v !== undefined && ["string", "number", "boolean"].includes(typeof v))
    .slice(0, 4)
    .map(([k, v]) => `${k.replace(/[_-]+/g, " ")} “${String(v).slice(0, 80)}”`);
  return `${title} in ${appName}${shown.length ? ` with ${shown.join(", ")}` : ""}`.slice(0, 500);
}

/** Per app: tool calls per minute, and requests that can wait for approval at once. */
export const MAX_CALLS_PER_MINUTE = 60;
export const MAX_PENDING_APPROVALS = 50;

/** A plain reason if this app has hit its call rate, else null. */
async function callLimit(connectorId: string): Promise<string | null> {
  const since = new Date(Date.now() - 60_000);
  const [{ n }] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(toolCalls)
    .where(and(eq(toolCalls.connectorId, connectorId), eq(toolCalls.source, "mcp"), gt(toolCalls.createdAt, since)));
  return n >= MAX_CALLS_PER_MINUTE ? `Too many calls to this app (more than ${MAX_CALLS_PER_MINUTE} a minute). Wait a minute and try again.` : null;
}

export async function runToolCall(
  connector: ConnectorForRuntime,
  action: PublishedAction,
  input: Record<string, unknown>,
): Promise<ToolCallOutcome> {
  // Abuse limits: an endpoint token can't flood the app, the database or our outbound network.
  const limited = await callLimit(connector.id);
  if (limited) return { kind: "done", status: "transient_failed", httpStatus: null, reason: limited, data: null, durationMs: 0 };

  // Destructive always needs approval, even if a row somehow says otherwise.
  if (action.requiresApproval || action.risk === "destructive") {
    const summary = approvalSummary(connector.name, action.title, input);
    const d = db();
    const [{ waiting }] = await d
      .select({ waiting: sql<number>`count(*)::int` })
      .from(approvals)
      .where(and(eq(approvals.connectorId, connector.id), eq(approvals.status, "pending")));
    if (waiting >= MAX_PENDING_APPROVALS) {
      return {
        kind: "done",
        status: "transient_failed",
        httpStatus: null,
        reason: `${MAX_PENDING_APPROVALS} requests are already waiting for approval in BYOMCP. Ask a person to review them first.`,
        data: null,
        durationMs: 0,
      };
    }
    const [call] = await d
      .insert(toolCalls)
      .values({
        connectorId: connector.id,
        versionId: action.versionId,
        actionId: action.id,
        actionKey: action.key,
        source: "mcp",
        input: redactInput(input),
        status: "pending_approval",
        attempts: 0,
      })
      .returning({ id: toolCalls.id });
    const [approval] = await d
      .insert(approvals)
      .values({ toolCallId: call.id, connectorId: connector.id, actionId: action.id, input, summary })
      .returning({ id: approvals.id });
    return { kind: "pending_approval", approvalId: approval.id, summary };
  }

  const run = await executeNow(connector, action, input);
  await logCall({
    connectorId: connector.id,
    versionId: action.versionId,
    actionId: action.id,
    actionKey: action.key,
    source: "mcp",
    input,
    result: run,
  });
  return { kind: "done", status: run.status, httpStatus: run.httpStatus, reason: run.reason, data: run.data, durationMs: run.durationMs };
}

export type ExecutedRun = Pick<ExecResult, "status" | "httpStatus" | "reason" | "data" | "durationMs" | "attempts" | "preview">;

/**
 * Run the action against the app right now (no approval check: callers decide).
 * Decrypts credentials for this call only and updates credential health.
 * Used by MCP calls that don't need approval, and by "Approve".
 */
export async function executeNow(connector: ConnectorForRuntime, action: PublishedAction, input: Record<string, unknown>): Promise<ExecutedRun> {
  const fail = (reason: string): ExecutedRun => ({ status: "request_error", httpStatus: null, reason, data: null, durationMs: 0, attempts: 0, preview: "" });
  if (!connector.baseUrl || !connector.authType) return fail(`${connector.name} isn't connected. Ask an admin to connect it in BYOMCP.`);
  let secret = null;
  if (connector.authType !== "none") {
    try {
      secret = await loadUsableSecret(connector.id);
    } catch {
      secret = null;
    }
    if (!secret) return fail(`The saved key for ${connector.name} can't be used. Ask an admin to reconnect it in BYOMCP.`);
  }

  const run = (s: typeof secret) =>
    execute(action, input, { baseUrl: connector.baseUrl!, authType: connector.authType!, apiKey: connector.authConfig ?? undefined, secret: s });
  let result = await run(secret);
  // "Connect with Zendesk": a 401 can mean the access token just expired. Refresh once and retry
  // (safe for writes too: a 401 means the app did nothing).
  if (result.status === "auth_failed" && result.httpStatus === 401 && (await isOAuthConnection(connector.id))) {
    const fresh = await loadUsableSecret(connector.id, { force: true }).catch(() => null);
    if (fresh) result = await run(fresh);
  }
  if (result.status === "auth_failed") await markCredential(connector.id, "needs_reconnect");
  else if (result.status === "success" && connector.authType !== "none") await markCredential(connector.id, "active");
  return result;
}
