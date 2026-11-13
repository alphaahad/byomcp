"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth/guard";
import { DEFAULT_MAX_PAGES, HARD_MAX_PAGES } from "@/server/import/crawl";
import { startAiImport } from "@/server/import/run-ai-import";
import { runOpenApiImport, type OpenApiSource } from "@/server/import/run-openapi-import";

export type SourceKind = "openapi" | "docs" | "text";
export type NewAppState = {
  error?: string;
  fields?: { name: string; source: SourceKind; openapiMode: string; url: string; docsUrl: string; maxPages: string; text: string };
};

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export async function createAppAction(_prev: NewAppState, formData: FormData): Promise<NewAppState> {
  const ws = await requireSession();

  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const source = (["openapi", "docs", "text"].includes(get("source")) ? get("source") : "openapi") as SourceKind;
  const fields = {
    name: get("name").slice(0, 80),
    source,
    openapiMode: get("openapiMode") || "url",
    url: get("url"),
    docsUrl: get("docsUrl"),
    maxPages: get("maxPages"),
    text: String(formData.get("text") ?? "").slice(0, 210_000),
  };

  if (source === "openapi") {
    let spec: OpenApiSource;
    if (fields.openapiMode === "file") {
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) return { error: "Choose an OpenAPI file to upload.", fields };
      if (file.size > MAX_UPLOAD_BYTES) {
        return { error: "That file is larger than 4 MB. Try a link to the spec instead, or a smaller spec.", fields };
      }
      spec = { kind: "openapi_file", fileName: file.name, text: await file.text() };
    } else {
      if (!fields.url) return { error: "Paste the link to the OpenAPI file.", fields };
      spec = { kind: "openapi_url", url: fields.url };
    }
    const outcome = await runOpenApiImport({ workspaceId: ws.id, isOwner: ws.isOwner, name: fields.name, source: spec });
    if (!outcome.ok) return { error: outcome.error, fields };
    redirect(`/apps/${outcome.connectorId}/review`);
  }

  if (source === "docs") {
    if (!fields.docsUrl) return { error: "Paste the link to the app's API docs.", fields };
    const n = Number(fields.maxPages);
    const maxPages = Number.isInteger(n) && n >= 1 ? Math.min(n, HARD_MAX_PAGES) : DEFAULT_MAX_PAGES;
    const started = await startAiImport({ workspaceId: ws.id, isOwner: ws.isOwner, name: fields.name, source: { kind: "docs_url", url: fields.docsUrl, maxPages } });
    if (!started.ok) return { error: started.error, fields };
    redirect(`/apps/import/${started.jobId}`);
  }

  if (!fields.text.trim()) return { error: "Paste the API docs text.", fields };
  const started = await startAiImport({ workspaceId: ws.id, isOwner: ws.isOwner, name: fields.name, source: { kind: "text", text: fields.text } });
  if (!started.ok) return { error: started.error, fields };
  redirect(`/apps/import/${started.jobId}`);
}
