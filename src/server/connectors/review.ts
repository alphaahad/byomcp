import "server-only";
/**
 * Review edits. Every safety rule is enforced here, whatever the browser sends:
 *  - destructive actions always need approval (also a DB check constraint)
 *  - risk can't go below what the HTTP method implies
 *  - changing method/path/params re-checks the whole action against the IR schema,
 *    resets the safe defaults when the risk changes, and drops "Tested"/"Sourced"
 *    to "Needs review" (the old evidence was about a different request)
 *  - only draft versions can be edited
 */
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  ActionIRSchema,
  HTTP_METHODS,
  RISK_TIERS,
  classifyRisk,
  defaultEnabled,
  defaultRequiresApproval,
  riskFromMethod,
  riskRank,
} from "@/lib/ir";
import { db } from "@/server/db";
import { actions, connectorVersions } from "@/server/db/schema";

type ActionRow = typeof actions.$inferSelect;

export const ActionPatchSchema = z
  .object({
    enabled: z.boolean(),
    requiresApproval: z.boolean(),
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1000),
    risk: z.enum(RISK_TIERS),
    method: z.enum(HTTP_METHODS),
    path: z.string().trim().min(1).max(500),
    paramsJson: z.string().max(100_000),
  })
  .partial();
export type ActionPatch = z.infer<typeof ActionPatchSchema>;

export type PatchResult = { ok: true; action: ActionRow } | { ok: false; error: string };

async function loadEditable(actionId: string): Promise<{ row: ActionRow } | { error: string }> {
  if (!z.uuid().safeParse(actionId).success) return { error: "That action wasn't found." };
  const [found] = await db()
    .select({ row: actions, versionStatus: connectorVersions.status })
    .from(actions)
    .innerJoin(connectorVersions, eq(actions.versionId, connectorVersions.id))
    .where(eq(actions.id, actionId))
    .limit(1);
  if (!found) return { error: "That action wasn't found." };
  if (found.versionStatus !== "draft") return { error: "This version is published. Start a new draft to make changes." };
  return { row: found.row };
}

/** Pure: apply a patch to a row under the review rules. Exported for tests. */
export function applyPatch(row: ActionRow, patch: ActionPatch): { next: ActionRow } | { error: string } {
  const next: ActionRow = { ...row };
  let shapeChanged = false;

  if (patch.title !== undefined && patch.title !== row.title) {
    next.title = patch.title;
    next.edited = true;
  }
  if (patch.description !== undefined && patch.description !== row.description) {
    next.description = patch.description;
    next.edited = true;
  }
  if (patch.method !== undefined && patch.method !== row.method) {
    next.method = patch.method;
    shapeChanged = true;
  }
  if (patch.path !== undefined && patch.path !== row.path) {
    next.path = patch.path;
    shapeChanged = true;
  }
  if (patch.paramsJson !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(patch.paramsJson);
    } catch {
      return { error: "The parameters aren't valid JSON. Check for a missing comma or quote." };
    }
    if (JSON.stringify(parsed) !== JSON.stringify(row.params)) {
      next.params = parsed as ActionRow["params"];
      shapeChanged = true;
    }
  }

  if (shapeChanged) {
    next.edited = true;
    // The evidence described the old request.
    next.evidence = "needs_review";
    next.lastTestedAt = null;
    const newRisk = classifyRisk({ method: next.method, key: next.key, title: next.title, path: next.path });
    if (newRisk !== row.risk) {
      next.risk = newRisk;
      next.enabled = defaultEnabled(newRisk);
      next.requiresApproval = defaultRequiresApproval(newRisk);
    }
  }

  if (patch.risk !== undefined && patch.risk !== next.risk) {
    if (riskRank(patch.risk) < riskRank(riskFromMethod(next.method))) {
      return { error: `A ${next.method} action can't be marked ${patch.risk === "read" ? "Read" : "Write"}: it changes data.` };
    }
    next.risk = patch.risk;
    next.edited = true;
    if (patch.risk === "destructive") next.requiresApproval = true;
  }
  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  if (patch.requiresApproval !== undefined) {
    if (!patch.requiresApproval && next.risk === "destructive") {
      return { error: "Destructive actions always need approval. This can't be turned off." };
    }
    next.requiresApproval = patch.requiresApproval;
  }

  const check = ActionIRSchema.safeParse({
    key: next.key,
    title: next.title,
    description: next.description,
    resource: next.resource,
    method: next.method,
    path: next.path,
    params: next.params,
    successCheck: next.successCheck ?? undefined,
    pagination: next.pagination ?? undefined,
    risk: next.risk,
    evidence: next.evidence,
    citation: next.citation ?? undefined,
    confidence: next.confidence,
  });
  if (!check.success) {
    const issue = check.error.issues[0];
    return { error: `That change isn't valid: ${issue.path.join(".") || "action"}: ${issue.message}` };
  }
  return { next };
}

export async function updateAction(actionId: string, patch: ActionPatch): Promise<PatchResult> {
  const loaded = await loadEditable(actionId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const applied = applyPatch(loaded.row, patch);
  if ("error" in applied) return { ok: false, error: applied.error };
  const n = applied.next;
  const [saved] = await db()
    .update(actions)
    .set({
      title: n.title,
      description: n.description,
      method: n.method,
      path: n.path,
      params: n.params,
      risk: n.risk,
      evidence: n.evidence,
      enabled: n.enabled,
      requiresApproval: n.requiresApproval,
      lastTestedAt: n.lastTestedAt,
      edited: n.edited,
    })
    .where(eq(actions.id, actionId))
    .returning();
  return { ok: true, action: saved };
}

/** Bulk switches, for the whole version or one group. Turning reads on never touches writes; turning off is always safe. */
export async function bulkSetEnabled(
  versionId: string,
  mode: "reads_on" | "all_off",
  resource?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!z.uuid().safeParse(versionId).success) return { ok: false, error: "Version not found." };
  const d = db();
  const [v] = await d.select().from(connectorVersions).where(eq(connectorVersions.id, versionId)).limit(1);
  if (!v || v.status !== "draft") return { ok: false, error: "This version is published. Start a new draft to make changes." };
  if (mode === "reads_on") {
    await d
      .update(actions)
      .set({ enabled: true })
      .where(and(eq(actions.versionId, versionId), eq(actions.risk, "read"), resource ? eq(actions.resource, resource) : undefined));
  } else {
    await d
      .update(actions)
      .set({ enabled: false })
      .where(and(eq(actions.versionId, versionId), resource ? eq(actions.resource, resource) : undefined));
  }
  return { ok: true };
}

/** Turn on exactly these actions in a draft version and turn the rest off (used by "pick by job"). */
export async function setEnabledExactly(versionId: string, actionIds: string[]): Promise<{ ok: boolean; error?: string }> {
  if (!z.uuid().safeParse(versionId).success) return { ok: false, error: "Version not found." };
  const d = db();
  const [v] = await d.select().from(connectorVersions).where(eq(connectorVersions.id, versionId)).limit(1);
  if (!v || v.status !== "draft") return { ok: false, error: "This version is published. Start a new draft to make changes." };
  await d.batch([
    d.update(actions).set({ enabled: false }).where(eq(actions.versionId, versionId)),
    d
      .update(actions)
      .set({ enabled: true })
      .where(and(eq(actions.versionId, versionId), inArray(actions.id, actionIds.length ? actionIds : ["00000000-0000-0000-0000-000000000000"]))),
  ]);
  return { ok: true };
}
