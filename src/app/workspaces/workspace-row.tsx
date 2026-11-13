"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { renameWorkspaceAction, setRevokedAction } from "./actions";

export type WorkspaceRowData = {
  id: string;
  label: string;
  isOwner: boolean;
  revoked: boolean;
  lastSignIn: string;
  apps: number;
  published: number;
  calls7d: number;
  aiImports: number;
  chatMessages: number;
  aiCost: string;
};

export function WorkspaceRow({ w }: { w: WorkspaceRowData }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "That didn't work.");
      setError(null);
      after?.();
      router.refresh();
    });

  return (
    <tr className={w.revoked ? "text-ink-soft" : ""}>
      <td className="py-2.5 pr-3 align-top">
        {editing ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const label = String(new FormData(e.currentTarget).get("label") ?? "");
              run(() => renameWorkspaceAction(w.id, label), () => setEditing(false));
            }}
          >
            <label htmlFor={`ws-${w.id}`} className="sr-only">
              Workspace name
            </label>
            <input id={`ws-${w.id}`} name="label" defaultValue={w.label} maxLength={60} required autoFocus className="field w-44 py-1 text-sm" onKeyDown={(e) => e.key === "Escape" && setEditing(false)} />
            <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
              Save
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-ink">{w.label}</span>
            {w.isOwner && <span className="text-xs text-ink-soft">Owner (you)</span>}
            {w.revoked && <span className="text-xs text-alarm">Revoked</span>}
            <button type="button" className="text-sm text-signal hover:underline" onClick={() => setEditing(true)} aria-label={`Rename ${w.label}`}>
              Rename
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-1 text-sm text-alarm">
            {error}
          </p>
        )}
      </td>
      <td className="py-2.5 pr-3 align-top whitespace-nowrap">{w.lastSignIn}</td>
      <td className="py-2.5 pr-3 text-right align-top whitespace-nowrap tabular-nums">
        {w.apps} <span className="text-ink-soft">({w.published} live)</span>
      </td>
      <td className="py-2.5 pr-3 text-right align-top whitespace-nowrap tabular-nums">{w.calls7d}</td>
      <td className="py-2.5 pr-3 text-right align-top whitespace-nowrap tabular-nums">
        {w.aiImports} <span className="text-ink-soft">/ {w.chatMessages} · {w.aiCost}</span>
      </td>
      <td className="py-2.5 text-right align-top">
        {!w.isOwner &&
          (w.revoked ? (
            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(() => setRevokedAction(w.id, false))}>
              Restore
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-sm text-alarm"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Revoke "${w.label}"? Their passcode stops working and they're signed out now. Their apps stay, and you can restore it later.`)) {
                  run(() => setRevokedAction(w.id, true));
                }
              }}
            >
              Revoke
            </button>
          ))}
      </td>
    </tr>
  );
}
