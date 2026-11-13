import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { isOAuthConnection, loadUsableSecret, markCredential } from "@/server/connectors/connection";
import { db } from "@/server/db";
import { actions, connectorVersions, connectors } from "@/server/db/schema";
import { logCall } from "./call-log";
import { execute, type CallStatus } from "./executor";

export type TryResult = {
  status: CallStatus;
  httpStatus: number | null;
  reason: string | null;
  durationMs: number;
  attempts: number;
  /** Response for display: parsed JSON (if small enough) or text. */
  data: unknown;
  truncated: boolean;
  tested: boolean;
};

const DISPLAY_MAX = 40_000;

/**
 * "Try it": run one READ action with the saved connection, from the UI.
 * Writes go through approvals (slice 5), never through Try it.
 * Success marks the action Tested; a 401/403 marks the credential "needs reconnect".
 */
export async function tryAction(actionId: string, input: Record<string, unknown>): Promise<TryResult | { error: string }> {
  if (!z.uuid().safeParse(actionId).success) return { error: "That action wasn't found." };
  const d = db();
  const [row] = await d
    .select({ action: actions, connector: connectors, version: connectorVersions })
    .from(actions)
    .innerJoin(connectorVersions, eq(actions.versionId, connectorVersions.id))
    .innerJoin(connectors, eq(connectorVersions.connectorId, connectors.id))
    .where(eq(actions.id, actionId))
    .limit(1);
  if (!row) return { error: "That action wasn't found." };
  const { action, connector, version } = row;

  if (action.risk !== "read") return { error: "Try it only runs read actions. Actions that change data run through approvals." };
  if (!connector.baseUrl || !connector.authType) return { error: "Connect your account first." };

  let secret = null;
  if (connector.authType !== "none") {
    try {
      secret = await loadUsableSecret(connector.id);
    } catch {
      return { error: "The saved key couldn't be read. Reconnect your account." };
    }
    if (!secret) return { error: "Connect your account first." };
  }

  const run = (s: typeof secret) =>
    execute(action, input, { baseUrl: connector.baseUrl!, authType: connector.authType!, apiKey: connector.authConfig ?? undefined, secret: s });
  let result = await run(secret);
  if (result.status === "auth_failed" && result.httpStatus === 401 && (await isOAuthConnection(connector.id))) {
    const fresh = await loadUsableSecret(connector.id, { force: true }).catch(() => null);
    if (fresh) result = await run(fresh);
  }

  await logCall({
    connectorId: connector.id,
    versionId: version.id,
    actionId: action.id,
    actionKey: action.key,
    source: "try_it",
    input,
    result,
  });

  const tested = result.status === "success";
  if (tested) {
    await d.update(actions).set({ evidence: "tested", lastTestedAt: new Date() }).where(eq(actions.id, action.id));
    if (connector.authType !== "none") await markCredential(connector.id, "active");
  } else if (result.status === "auth_failed") {
    await markCredential(connector.id, "needs_reconnect");
  }

  const json = typeof result.data === "string" ? result.data : JSON.stringify(result.data ?? null);
  const truncated = json.length > DISPLAY_MAX;
  return {
    status: result.status,
    httpStatus: result.httpStatus,
    reason: result.reason,
    durationMs: result.durationMs,
    attempts: result.attempts,
    data: truncated ? json.slice(0, DISPLAY_MAX) : result.data,
    truncated,
    tested,
  };
}
