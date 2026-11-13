import "server-only";
/**
 * "Connected and working ✓": right after a connection is saved, run the read a
 * newcomer could run without knowing any IDs, with the saved key. Same path as
 * Try it (logged, marks Tested, flags a rejected key), so the result shows up
 * in Setup, Health and Activity like any other call.
 */
import { and, desc, eq, gt } from "drizzle-orm";
import { autoInputs, bestRead } from "@/lib/best-read";
import { countRecords, describeCount } from "@/lib/records";
import { db } from "@/server/db";
import { actions, toolCalls } from "@/server/db/schema";
import { tryAction } from "@/server/runtime/try-action";
import { getConnectorForReview } from "./queries";

/**
 * Runs the check. ran = false if no read can run without inputs (nothing was sent).
 * found = "25 tickets" when the full response was a list (the stored preview is truncated).
 */
export async function runConnectionCheck(connectorId: string): Promise<{ ran: boolean; found: string | null }> {
  const data = await getConnectorForReview(connectorId);
  if (!data) return { ran: false, found: null };
  const pick = bestRead(data.actions);
  const input = pick ? autoInputs(pick) : null;
  if (!pick || !input) return { ran: false, found: null };
  const r = await tryAction(pick.id, input);
  if ("error" in r) return { ran: false, found: null };
  const counted = r.status === "success" ? countRecords(r.data) : null;
  return { ran: true, found: counted ? describeCount(counted) : null };
}

export type ConnectionCheck = {
  ok: boolean;
  actionTitle: string;
  status: string;
  httpStatus: number | null;
  reason: string | null;
  /** "25 tickets", when the response is a list. */
  found: string | null;
};

/** The most recent check (a Try it call in the last 10 minutes), for the result card. */
export async function latestConnectionCheck(connectorId: string): Promise<ConnectionCheck | null> {
  const since = new Date(Date.now() - 10 * 60 * 1000);
  const [row] = await db()
    .select({ call: toolCalls, title: actions.title })
    .from(toolCalls)
    .leftJoin(actions, eq(toolCalls.actionId, actions.id))
    .where(and(eq(toolCalls.connectorId, connectorId), eq(toolCalls.source, "try_it"), gt(toolCalls.createdAt, since)))
    .orderBy(desc(toolCalls.createdAt))
    .limit(1);
  if (!row) return null;
  const counted = row.call.status === "success" ? countRecords(row.call.responsePreview) : null;
  return {
    ok: row.call.status === "success",
    actionTitle: row.title ?? row.call.actionKey,
    status: row.call.status,
    httpStatus: row.call.httpStatus,
    reason: row.call.failureReason,
    found: counted ? describeCount(counted) : null,
  };
}
