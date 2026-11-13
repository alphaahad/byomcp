"use client";

import { useState } from "react";

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };
  return { copied, copy };
}

/**
 * "Add it to UnleashX" in three steps, plus a ready-made message for whoever
 * manages UnleashX. The message never includes the token: that's shared
 * separately and privately.
 */
export function Handoff({ appName, endpoint, tools }: { appName: string; endpoint: string; tools: number }) {
  const { copied, copy } = useCopy();
  const message = `Hi! I've set up ${appName} for our AI employees with BYOMCP. Could you add it in UnleashX as a custom MCP server?

Server address: ${endpoint}
Sign-in: an Authorization header with a Bearer token. I'll send you the token privately.

It has ${tools} tool${tools === 1 ? "" : "s"}, and anything that changes data waits for my approval in BYOMCP. Thanks!`;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="handoff-title">
      <h2 id="handoff-title" className="text-[1.0625rem] font-semibold">
        Add it to UnleashX
      </h2>
      <ol className="flex flex-col gap-3 text-sm">
        <li className="flex gap-3">
          <span aria-hidden className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--signal-tint)] text-xs font-semibold text-signal">
            1
          </span>
          <span>
            <span className="font-semibold">Copy the setup above</span> (the address and the token, together). The token is shown only right after you
            create it; if you didn&apos;t save it, make a new one.
          </span>
        </li>
        <li className="flex gap-3">
          <span aria-hidden className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--signal-tint)] text-xs font-semibold text-signal">
            2
          </span>
          <span>
            <span className="font-semibold">In UnleashX, open Add Tool and add a custom MCP server.</span> Paste the address, and put the token in the
            Authorization header as <span className="font-mono">Bearer</span> followed by the token.
          </span>
        </li>
        <li className="flex gap-3">
          <span aria-hidden className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--signal-tint)] text-xs font-semibold text-signal">
            3
          </span>
          <span>
            <span className="font-semibold">Give it to an AI employee</span> and ask it to do one of the jobs you picked. This page shows &quot;✓ used&quot; as soon
            as the first call arrives.
          </span>
        </li>
      </ol>

      <details className="rounded-[var(--radius)] border border-[var(--separator)] p-3 text-sm">
        <summary className="cursor-pointer font-medium text-signal">Someone else sets up UnleashX? Send them this</summary>
        <div className="mt-2 flex flex-col gap-2">
          <p className="rounded-[var(--radius-sm)] bg-[var(--bg)] p-3 whitespace-pre-wrap">{message}</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-sm" onClick={() => copy("message", message)}>
              {copied === "message" ? "Copied" : "Copy message"}
            </button>
            <span className="text-ink-soft">Send the token separately, in a private message.</span>
          </div>
        </div>
      </details>

      <details className="rounded-[var(--radius)] border border-[var(--separator)] p-3 text-sm">
        <summary className="cursor-pointer font-medium">Other tools: Claude, MCP Inspector</summary>
        <div className="mt-3 flex flex-col gap-4">
          <div>
            <p className="font-semibold">Claude</p>
            <p>
              Settings, Connectors, Add custom connector, and paste the address. If you can&apos;t add a header there, turn on &quot;Also allow the token
              in the URL&quot; above, make a new token, and use the address with the token built in.
            </p>
          </div>
          <div>
            <p className="font-semibold">MCP Inspector (on your computer)</p>
            <pre className="bevel-in mt-1 overflow-x-auto p-2 font-mono text-xs">npx @modelcontextprotocol/inspector</pre>
            <p>Choose &quot;Streamable HTTP&quot;, paste the address, add the Authorization header, then Connect and List tools.</p>
          </div>
        </div>
      </details>
    </section>
  );
}
