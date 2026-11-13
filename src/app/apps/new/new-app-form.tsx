"use client";

import { useActionState, useState } from "react";
import { createAppAction, type NewAppState, type SourceKind } from "./actions";

const SOURCES: { value: SourceKind; label: string; hint: string }[] = [
  { value: "openapi", label: "An OpenAPI or Swagger file", hint: "Most accurate, and free: no AI needed." },
  { value: "docs", label: "A link to the API docs", hint: "AI reads the pages once and drafts the actions. A few cents at most." },
  { value: "text", label: "Docs text I'll paste", hint: "For docs behind a login, or copied from a PDF. Also uses AI." },
];

export function NewAppForm({ prefill }: { prefill?: { source?: SourceKind; url?: string } }) {
  const [state, action, pending] = useActionState<NewAppState, FormData>(createAppAction, {});
  const f = state.fields;
  const [source, setSource] = useState<SourceKind>(f?.source ?? prefill?.source ?? "openapi");
  const [openapiMode, setOpenapiMode] = useState(f?.openapiMode ?? "url");

  const pendingLabel = source === "openapi" ? "Reading the spec…" : "Starting…";
  const submitLabel = source === "openapi" ? "Read the spec" : "Read the docs";

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="font-semibold">
          App name <span className="font-normal">(optional)</span>
        </label>
        <input id="name" name="name" defaultValue={f?.name} placeholder="We'll use the name from the docs if you leave this blank" className="field" />
      </div>

      <fieldset className="groupbox">
        <legend>What do you have?</legend>
        <div className="flex flex-col gap-3">
          {SOURCES.map((s) => (
            <label key={s.value} className="flex cursor-pointer items-start gap-2">
              <input type="radio" name="source" value={s.value} checked={source === s.value} onChange={() => setSource(s.value)} className="chk mt-1" />
              <span>
                <span className="font-semibold">{s.label}</span>
                <span className="block text-sm text-ink-soft">{s.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {source === "openapi" && (
        <fieldset className="groupbox">
          <legend>OpenAPI file</legend>
          <div className="flex flex-col gap-3">
            <div className="flex gap-5" role="radiogroup" aria-label="How to provide the OpenAPI file">
              <label className="flex cursor-pointer items-center gap-2">
                <input type="radio" name="openapiMode" value="url" checked={openapiMode === "url"} onChange={() => setOpenapiMode("url")} className="chk" />
                Link
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="radio" name="openapiMode" value="file" checked={openapiMode === "file"} onChange={() => setOpenapiMode("file")} className="chk" />
                Upload
              </label>
            </div>
            {openapiMode === "url" ? (
              <div className="flex flex-col gap-1">
                <label htmlFor="url" className="font-semibold">
                  Link to the OpenAPI or Swagger file
                </label>
                <input id="url" name="url" type="url" inputMode="url" defaultValue={f?.url ?? prefill?.url} placeholder="https://api.example.com/openapi.json" className="field" />
                <p className="text-sm text-ink-soft">A .json or .yaml file, often linked from the API docs as &quot;OpenAPI&quot;, &quot;Swagger&quot; or &quot;API spec&quot;.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <label htmlFor="file" className="font-semibold">
                  OpenAPI or Swagger file
                </label>
                <input id="file" name="file" type="file" accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml" className="field" />
                <p className="text-sm text-ink-soft">JSON or YAML, up to 4 MB.</p>
              </div>
            )}
          </div>
        </fieldset>
      )}

      {source === "docs" && (
        <fieldset className="groupbox">
          <legend>Docs link</legend>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="docsUrl" className="font-semibold">
                Link to the API docs
              </label>
              <input id="docsUrl" name="docsUrl" type="url" inputMode="url" defaultValue={f?.docsUrl} placeholder="https://developers.example.com/reference/tickets" className="field" />
              <p className="text-sm text-ink-soft">
                Start from the API reference page for what you need (for example &quot;Tickets&quot;). We also read nearby pages in the same section.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="maxPages" className="font-semibold">
                Pages to read
              </label>
              <select id="maxPages" name="maxPages" defaultValue={f?.maxPages || "10"} className="field max-w-48">
                <option value="1">Just this page</option>
                <option value="5">Up to 5</option>
                <option value="10">Up to 10</option>
                <option value="25">Up to 25</option>
              </select>
              <p className="text-sm text-ink-soft">More pages finds more actions and costs a little more.</p>
            </div>
          </div>
        </fieldset>
      )}

      {source === "text" && (
        <fieldset className="groupbox">
          <legend>Docs text</legend>
          <div className="flex flex-col gap-1">
            <label htmlFor="text" className="font-semibold">
              API docs text
            </label>
            <textarea id="text" name="text" rows={12} defaultValue={f?.text} className="field font-mono text-sm" />
            <p className="text-sm text-ink-soft">Paste the parts that describe requests: methods, paths and parameters. Up to 200,000 characters.</p>
          </div>
        </fieldset>
      )}

      <p className="text-sm">🔒 We never send your app logins or keys to the AI. Only the docs text is sent.</p>

      {state.error && (
        <p role="alert" className="bevel-in p-3 text-alarm">
          ⚠ <span className="text-ink">{state.error}</span>
        </p>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? pendingLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}
