"use server";

import { ownsAction, ownsVersion, requireSession } from "@/server/auth/guard";
import { eq } from "drizzle-orm";
import { catalogForSource, jobActionIds } from "@/lib/catalog";
import { ActionPatchSchema, bulkSetEnabled, setEnabledExactly, updateAction, type ActionPatch } from "@/server/connectors/review";
import { db } from "@/server/db";
import { actions, connectorVersions } from "@/server/db/schema";
import { tryAction, type TryResult } from "@/server/runtime/try-action";

export type UpdateResult = { ok: true } | { ok: false; error: string };

export async function updateActionAction(actionId: string, patch: ActionPatch): Promise<UpdateResult> {
  await requireSession();
  if (!(await ownsAction(actionId))) return { ok: false, error: "That action wasn't found." };
  const parsed = ActionPatchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: "That change isn't valid." };
  const res = await updateAction(actionId, parsed.data);
  return res.ok ? { ok: true } : res;
}

export async function bulkAction(versionId: string, mode: "reads_on" | "all_off", resource?: string): Promise<UpdateResult> {
  await requireSession();
  if (!(await ownsVersion(versionId))) return { ok: false, error: "That version wasn't found." };
  if (mode !== "reads_on" && mode !== "all_off") return { ok: false, error: "Unknown action." };
  const res = await bulkSetEnabled(versionId, mode, typeof resource === "string" ? resource.slice(0, 60) : undefined);
  return res.ok ? { ok: true } : { ok: false, error: res.error ?? "Couldn't update." };
}

export async function tryActionAction(actionId: string, input: Record<string, unknown>): Promise<TryResult | { error: string }> {
  await requireSession();
  if (!(await ownsAction(actionId))) return { error: "That action wasn't found." };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Inputs must be a set of fields." };
  return tryAction(actionId, input);
}

/** "Pick by job": turn on exactly the actions behind the chosen catalog jobs. */
export async function applyJobsAction(versionId: string, jobKeys: string[]): Promise<UpdateResult & { count?: number }> {
  await requireSession();
  if (!(await ownsVersion(versionId))) return { ok: false, error: "That version wasn't found." };
  const keys = Array.isArray(jobKeys) ? jobKeys.filter((k) => typeof k === "string").slice(0, 10) : [];
  if (keys.length === 0) return { ok: false, error: "Choose at least one job." };
  const d = db();
  const [v] = await d.select({ sourceRef: connectorVersions.sourceRef }).from(connectorVersions).where(eq(connectorVersions.id, versionId)).limit(1);
  const app = catalogForSource(v?.sourceRef);
  if (!app) return { ok: false, error: "This app isn't in the catalog. Choose actions yourself below." };
  const jobs = app.jobs.filter((j) => keys.includes(j.key));
  const rows = await d.select({ id: actions.id, method: actions.method, path: actions.path }).from(actions).where(eq(actions.versionId, versionId));
  const ids = jobActionIds(jobs, rows);
  if (ids.length === 0) return { ok: false, error: "We couldn't match those jobs to this app's actions. Choose actions yourself below." };
  const res = await setEnabledExactly(versionId, ids);
  return res.ok ? { ok: true, count: ids.length } : { ok: false, error: res.error ?? "Couldn't update." };
}
