import "server-only";
import { db } from "@/server/db";
import { toolCalls } from "@/server/db/schema";
import type { ExecResult } from "./executor";

const SECRETISH = /(authorization|api[-_]?key|apikey|token|secret|password|passwd|cookie|session)/i;

/** Copy of the input with secret-looking fields hidden, for the call log. */
export function redactInput(input: Record<string, unknown>): Record<string, unknown> {
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 6) return "[…]";
    if (Array.isArray(v)) return v.slice(0, 50).map((x) => walk(x, depth + 1));
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRETISH.test(k) ? "[hidden]" : walk(x, depth + 1)]));
    }
    return typeof v === "string" && v.length > 500 ? `${v.slice(0, 500)}…` : v;
  };
  return walk(input, 0) as Record<string, unknown>;
}

export async function logCall(entry: {
  connectorId: string;
  versionId: string | null;
  actionId: string | null;
  actionKey: string;
  source: "mcp" | "try_it" | "approval";
  input: Record<string, unknown>;
  result: Pick<ExecResult, "status" | "httpStatus" | "reason" | "durationMs" | "attempts" | "preview"> | { status: "pending_approval" | "rejected"; reason?: string | null };
}): Promise<string> {
  const r = entry.result;
  const [row] = await db()
    .insert(toolCalls)
    .values({
      connectorId: entry.connectorId,
      versionId: entry.versionId,
      actionId: entry.actionId,
      actionKey: entry.actionKey,
      source: entry.source,
      input: redactInput(entry.input),
      status: r.status,
      httpStatus: "httpStatus" in r ? r.httpStatus : null,
      failureReason: r.reason ?? null,
      durationMs: "durationMs" in r ? r.durationMs : null,
      attempts: "attempts" in r ? r.attempts : 0,
      responsePreview: "preview" in r ? r.preview : null,
    })
    .returning({ id: toolCalls.id });
  return row.id;
}
