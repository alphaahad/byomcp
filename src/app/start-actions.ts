"use server";

import { redirect } from "next/navigation";
import { catalogApp } from "@/lib/catalog";
import { requireSession } from "@/server/auth/guard";
import { requestApp } from "@/server/workspaces/workspaces";
import { runConnectionCheck } from "@/server/connectors/auto-check";
import { saveConnection } from "@/server/connectors/connection";
import { getConnectorForReview } from "@/server/connectors/queries";
import { startAiImport } from "@/server/import/run-ai-import";
import { runOpenApiImport } from "@/server/import/run-openapi-import";
import { SafeFetchError, assertPublicBaseUrl, assertSafeUrl, safeFetch } from "@/server/net/safe-fetch";

export type StartState = { error?: string; url?: string };

const SPEC_START = /^\s*(\{\s*"(openapi|swagger)"|(openapi|swagger)\s*:)/;

/**
 * One input for any link. If it's an OpenAPI/Swagger file we read it directly
 * (free, no AI); otherwise it's a docs page and AI reads it once.
 */
export async function startFromLink(_prev: StartState, formData: FormData): Promise<StartState> {
  const ws = await requireSession();
  // A catalog app is chosen by key; its URL comes from the catalog, never from the browser.
  const preset = catalogApp(formData.get("app"));
  const url = (preset?.source.url ?? String(formData.get("url") ?? "")).trim();
  const name = preset?.name ?? undefined;
  if (!url) return { error: "Paste a link to the app's API docs or OpenAPI file." };

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^https?:\/\//i.test(url)) return { error: "Only secure web addresses (https://) are allowed.", url };

  let normalized: string;
  try {
    normalized = assertSafeUrl(/^https?:\/\//i.test(url) ? url : `https://${url}`).toString();
  } catch (err) {
    return { error: err instanceof SafeFetchError ? err.message : "That link isn't valid.", url };
  }

  // Peek at the link to decide the path.
  let isSpec = preset ? preset.source.kind === "openapi_url" : /\.(json|ya?ml)(\?|$)/i.test(new URL(normalized).pathname);
  if (!isSpec && !preset) {
    try {
      const res = await safeFetch(normalized, { maxBytes: 5 * 1024 * 1024, headers: { accept: "application/json, application/yaml, text/html;q=0.9, */*;q=0.5" } });
      const type = String(res.headers["content-type"] ?? "");
      isSpec = res.status < 300 && (/(json|yaml)/i.test(type) ? SPEC_START.test(res.text()) : SPEC_START.test(res.text().slice(0, 2000)));
      if (res.status >= 400) return { error: `That page returned an error (HTTP ${res.status}). Check the link opens in your browser.`, url };
    } catch (err) {
      return { error: err instanceof SafeFetchError ? err.message : "We couldn't open that link.", url };
    }
  }

  if (isSpec) {
    const outcome = await runOpenApiImport({ workspaceId: ws.id, isOwner: ws.isOwner, name, source: { kind: "openapi_url", url: normalized } });
    if (!outcome.ok) return { error: outcome.error, url };
    if (preset?.sample) {
      // The sample API needs no sign-in: connect it so a newcomer can try it straight away.
      const data = await getConnectorForReview(outcome.connectorId);
      const base = data?.version?.detected?.baseUrl;
      if (base && !base.includes("{")) {
        try {
          await saveConnection({ connectorId: outcome.connectorId, baseUrl: await assertPublicBaseUrl(base), authType: "none" });
          await runConnectionCheck(outcome.connectorId); // the newcomer sees it already working (Tested)
        } catch {
          // Leave it unconnected; the Setup panel will point to Connection.
        }
      }
    }
    redirect(`/apps/${outcome.connectorId}/review?new=1`);
  }

  const started = await startAiImport({ workspaceId: ws.id, isOwner: ws.isOwner, name, source: { kind: "docs_url", url: normalized, maxPages: 10 } });
  if (!started.ok) return { error: started.error, url };
  redirect(`/apps/import/${started.jobId}`);
}

export type RequestState = { ok?: boolean; error?: string };

/** "Don't see your app? Tell us." */
export async function requestAppAction(_prev: RequestState, formData: FormData): Promise<RequestState> {
  const ws = await requireSession();
  const appName = String(formData.get("appName") ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  if (!appName) return { error: "Which app? Type its name." };
  const r = await requestApp(ws.id, appName, note);
  return r.ok ? { ok: true } : { error: r.error };
}
