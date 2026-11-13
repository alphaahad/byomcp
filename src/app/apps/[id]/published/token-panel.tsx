"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CopyField } from "@/components/copy-field";
import { CopySetup } from "@/components/copy-setup";
import { rotateTokenAction, setUrlTokenAction } from "./actions";

type Props = {
  connectorId: string;
  endpoint: string;
  activePrefix: string | null;
  lastUsedAt: string | null;
  allowUrlToken: boolean;
  justIssued?: string | null;
};

export function TokenPanel({ connectorId, endpoint, activePrefix, lastUsedAt, allowUrlToken, justIssued }: Props) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(justIssued ?? null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const rotate = () =>
    start(async () => {
      if (activePrefix && !confirm("Make a new token? The current one stops working right away, so anything using it must be updated.")) return;
      const r = await rotateTokenAction(connectorId);
      if (!r.ok) return setError(r.error);
      setToken(r.token);
      router.refresh();
    });

  return (
    <div className="tearoff flex flex-col gap-3" aria-label="Connection details for MCP clients">
      <p className="text-[1.0625rem] font-semibold">Connect an MCP client</p>
      <CopyField label="MCP server URL" value={endpoint} />
      {token ? (
        <>
          <CopySetup endpoint={endpoint} token={token} />
          <CopyField label="Access token" value={token} secret />
          <CopyField label="Header to send" value={`Authorization: Bearer ${token}`} secret />
          {allowUrlToken && <CopyField label="URL with the token built in (less secure)" value={`${endpoint}/k/${token}`} secret />}
        </>
      ) : (
        <p className="text-sm">
          Access token: <span className="font-mono">{activePrefix ? `${activePrefix}…` : "none yet"}</span>
          {lastUsedAt ? `, last used ${new Date(lastUsedAt).toLocaleString()}` : activePrefix ? ", not used yet" : ""}. Tokens are shown once.
          Lost it? Make a new one.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-sm" onClick={rotate} disabled={pending}>
          {pending ? "Working…" : activePrefix ? "Make a new token" : "Create a token"}
        </button>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="chk"
            checked={allowUrlToken}
            disabled={pending}
            onChange={(e) =>
              start(async () => {
                await setUrlTokenAction(connectorId, e.target.checked);
                router.refresh();
              })
            }
          />
          Also allow the token in the URL (for clients that can&apos;t send headers; less secure: URLs end up in logs and history)
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-alarm">
          {error}
        </p>
      )}
    </div>
  );
}
