import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import type { BatchItem } from "drizzle-orm/batch";
import { defaultRequiresApproval, initialEnabled } from "@/lib/ir";
import { catalogForSource, sameOperation } from "@/lib/catalog";
import { CREDENTIAL_FLAG } from "@/lib/tool-input";
import { db } from "@/server/db";
import { actions, connectorVersions, connectors, importJobs } from "@/server/db/schema";
import { SafeFetchError, safeFetch } from "@/server/net/safe-fetch";
import { GUEST_MAX_APPS, TOO_MANY_APPS, appCount } from "@/server/workspaces/workspaces";
import { OpenApiImportError, importOpenApi, parseSpecText } from "./openapi";

export type OpenApiSource =
  | { kind: "openapi_url"; url: string }
  | { kind: "openapi_file"; fileName: string; text: string };

export type ImportOutcome =
  | { ok: true; connectorId: string; actionCount: number }
  | { ok: false; error: string };

const INSERT_CHUNK = 100;

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "app"}-${randomBytes(2).toString("hex")}`;
}

async function loadText(source: OpenApiSource): Promise<string> {
  if (source.kind === "openapi_file") return source.text;
  const res = await safeFetch(source.url, {
    headers: { accept: "application/json, application/yaml, text/yaml, text/plain;q=0.9, */*;q=0.5" },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new OpenApiImportError(
      `That address returned an error (HTTP ${res.status}). Check the link opens the spec file in your browser.`,
    );
  }
  return res.text();
}

/**
 * OpenAPI import, end to end: fetch (SSRF-guarded) or take the uploaded text,
 * map to Action IR, and save connector + draft version 1 + actions + job record
 * in one batch (Neon runs a batch as a single transaction).
 * Cost is $0: this path uses no AI.
 */
export async function runOpenApiImport(input: { workspaceId: string; isOwner?: boolean; name?: string; source: OpenApiSource }): Promise<ImportOutcome> {
  if (!input.isOwner && (await appCount(input.workspaceId)) >= GUEST_MAX_APPS) return { ok: false, error: TOO_MANY_APPS };
  try {
    const text = await loadText(input.source);
    const sourceUrl = input.source.kind === "openapi_url" ? input.source.url : undefined;
    const result = await importOpenApi(parseSpecText(text), { sourceUrl });

    const connectorId = randomUUID();
    const versionId = randomUUID();
    const name = input.name?.trim() || result.detected.apiTitle;
    const d = db();

    // A catalog app may vouch that some POSTs only read (e.g. a search): those start as reads.
    // Only ever write -> read, never for anything classed destructive.
    const app = catalogForSource(sourceUrl);
    const riskOf = (a: (typeof result.actions)[number]) =>
      a.risk === "write" && app?.readOps?.some((o) => sameOperation(o, a)) ? ("read" as const) : a.risk;

    // A catalog app whose key lives in the path (GREEN-API): flag that parameter so it's
    // filled from the saved secret and never shown to the AI employee.
    const pathKey = app?.auth.type === "api_key" && app.auth.in === "path" ? app.auth.name : null;
    const paramsOf = (a: (typeof result.actions)[number]) =>
      pathKey && pathKey in a.params.path.properties
        ? {
            ...a.params,
            path: {
              ...a.params.path,
              properties: { ...a.params.path.properties, [pathKey]: { type: "string", [CREDENTIAL_FLAG]: true } },
              required: a.params.path.required?.filter((r) => r !== pathKey),
            },
          }
        : a.params;

    const rows = result.actions.map((a) => ({
      versionId,
      key: a.key,
      title: a.title,
      description: a.description,
      resource: a.resource,
      method: a.method,
      path: a.path,
      params: paramsOf(a),
      successCheck: a.successCheck,
      pagination: a.pagination,
      risk: riskOf(a),
      evidence: a.evidence,
      citation: a.citation,
      confidence: a.confidence,
      enabled: initialEnabled(riskOf(a), result.actions.length),
      requiresApproval: defaultRequiresApproval(riskOf(a)),
    }));

    const actionInserts: BatchItem<"pg">[] = [];
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      actionInserts.push(d.insert(actions).values(rows.slice(i, i + INSERT_CHUNK)));
    }

    await d.batch([
      d.insert(connectors).values({ id: connectorId, workspaceId: input.workspaceId, name: name.slice(0, 80), slug: slugify(name) }),
      d.insert(connectorVersions).values({
        id: versionId,
        connectorId,
        version: 1,
        sourceType: input.source.kind,
        sourceRef: sourceUrl ?? (input.source.kind === "openapi_file" ? input.source.fileName.slice(0, 200) : null),
        detected: result.detected,
        skipped: result.skipped,
      }),
      ...actionInserts,
      d.insert(importJobs).values({
        connectorId,
        versionId,
        status: "done",
        pagesRead: 1,
        actionsFound: result.actions.length,
        finishedAt: new Date(),
      }),
    ]);

    return { ok: true, connectorId, actionCount: result.actions.length };
  } catch (err) {
    if (err instanceof OpenApiImportError || err instanceof SafeFetchError) return { ok: false, error: err.message };
    console.error("OpenAPI import failed", err instanceof Error ? err.message : err);
    return { ok: false, error: "Something went wrong saving this app. Try again, and if it keeps happening, try a smaller spec." };
  }
}
