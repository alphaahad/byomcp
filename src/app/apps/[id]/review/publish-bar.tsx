"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CopyField } from "@/components/copy-field";
import { CopySetup } from "@/components/copy-setup";
import { MANY_TOOLS_WARNING } from "@/lib/ir";
import { publishAction, startDraftAction } from "../published/actions";

type Props = {
  connectorId: string;
  versionNumber: number;
  versionStatus: "draft" | "published" | "superseded";
  hasLive: boolean;
  connected: boolean;
  onCount: number;
  endpoint: string;
};

/** The one primary action of the review screen: Connect → Publish → Published. */
export function PublishBar({ connectorId, versionNumber, versionStatus, hasLive, connected, onCount, endpoint }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<string | null>(null);

  if (issued) {
    return (
      <div className="tearoff flex flex-col gap-3">
        <p className="text-[1.0625rem] font-semibold">Published. Copy your access token now: it&apos;s shown once.</p>
        <CopySetup endpoint={endpoint} token={issued} />
        <CopyField label="MCP server URL" value={endpoint} />
        <CopyField label="Access token" value={issued} secret />
        <div>
          <Link href={`/apps/${connectorId}/published`} className="btn btn-primary">
            I&apos;ve copied it: continue
          </Link>
        </div>
      </div>
    );
  }

  if (versionStatus !== "draft") {
    return (
      <div className="bevel-in flex flex-wrap items-center gap-3 p-3">
        <p className="flex-1 text-sm">
          v{versionNumber} is live. To change it, start a new draft: the live version keeps working until you publish again.
        </p>
        <button
          type="button"
          className="btn btn-sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await startDraftAction(connectorId);
              if (!r.ok) setError(r.error);
              router.refresh();
            })
          }
        >
          Start a new draft
        </button>
        <Link href={`/apps/${connectorId}/published`} className="btn btn-sm">
          Published details
        </Link>
        {error && <p className="w-full text-sm text-alarm">{error}</p>}
      </div>
    );
  }

  const blocked = !connected ? "Connect your account first." : onCount === 0 ? "Turn on at least one action first." : null;
  return (
    <div className="bevel-in flex flex-wrap items-center gap-3 p-3">
      <p className="flex-1 text-sm">
        {hasLive ? `Draft v${versionNumber}: your changes aren't live until you publish.` : `Draft v${versionNumber}.`} Publishing gives you an
        MCP server URL with {onCount} {onCount === 1 ? "tool" : "tools"}.
        {blocked && <span className="block font-semibold">{blocked}</span>}
        {!blocked && onCount > MANY_TOOLS_WARNING && (
          <span className="block font-semibold text-warn">
            {onCount} tools is a lot: models choose less reliably past about {MANY_TOOLS_WARNING}. You can still publish.
          </span>
        )}
      </p>
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending || !!blocked}
        onClick={() =>
          start(async () => {
            const r = await publishAction(connectorId);
            if (!r.ok) return setError(r.error);
            if (r.token) setIssued(r.token);
            else router.push(`/apps/${connectorId}/published`);
          })
        }
      >
        {pending ? "Publishing…" : hasLive ? `Publish v${versionNumber}` : "Publish"}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-alarm">
          {error}
        </p>
      )}
    </div>
  );
}
