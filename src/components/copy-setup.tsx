"use client";

import { useState } from "react";

/** One button that copies everything an MCP client needs: the address and the token. */
export function CopySetup({ endpoint, token }: { endpoint: string; token: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-sm)] bg-[var(--signal-tint)] p-3">
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(`MCP server address: ${endpoint}\nAuthorization header: Bearer ${token}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied" : "Copy setup"}
      </button>
      <span className="text-sm">The address and the token together, ready to paste into UnleashX. Save the token somewhere safe: it&apos;s shown only now.</span>
    </div>
  );
}
