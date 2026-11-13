"use client";

import { useState } from "react";
import type { CatalogApp } from "@/lib/catalog";

/** "Where to find your key": catalog steps, plus a message for whoever can make one. */
export function KeyGuide({ appName, app }: { appName: string; app: CatalogApp | null }) {
  const [copied, setCopied] = useState(false);
  if (app?.auth.type === "none") return null;

  const message = `Hi! I'm setting up an AI employee to work with ${appName}. Could you create an API key (or access token) for it, with read access to what it needs? Please send it to me privately (not in a shared channel). Thanks!`;

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--separator)] bg-[var(--bg)] p-4">
      {app ? (
        <>
          <p className="font-semibold">Where to find your key in {appName}</p>
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
            {app.keySteps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          {(app.keyHelpUrl || app.adminNeeded) && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft">
              {app.keyHelpUrl && (
                <a href={app.keyHelpUrl} target="_blank" rel="noreferrer noopener">
                  {appName}&apos;s guide to API keys ↗
                </a>
              )}
              {app.adminNeeded && <span>You need admin rights in {appName} to create one.</span>}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm">
          <span className="font-semibold">Where&apos;s the key?</span> In {appName}&apos;s settings, look for &quot;API&quot;, &quot;API keys&quot;,
          &quot;Developers&quot; or &quot;Integrations&quot;. The docs you imported usually explain it on a page called &quot;Authentication&quot;.
        </p>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-signal">I can&apos;t create a key</summary>
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-ink-soft">Ask whoever manages {appName} at your company. Here&apos;s a message you can send:</p>
          <p className="rounded-[var(--radius-sm)] border border-[var(--separator)] bg-[var(--surface)] p-3">{message}</p>
          <div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(message);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "Copied" : "Copy message"}
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
