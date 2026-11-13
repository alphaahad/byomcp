"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ResultView } from "@/components/result-view";
import { RiskLabel, Stamp } from "@/components/ui";
import { approveAction, rejectAction, type DecisionOutcome } from "./actions";

export type PendingApproval = {
  id: string;
  shortId: string;
  summary: string;
  input: Record<string, unknown>;
  createdAt: string;
  connectorId: string;
  connectorName: string;
  actionTitle: string | null;
  risk: "read" | "write" | "destructive" | null;
};

function ago(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleString();
}

export function ApprovalCard({ a }: { a: PendingApproval }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState<DecisionOutcome | null>(null);

  const decide = (fn: typeof approveAction) =>
    start(async () => {
      const r = await fn(a.id);
      setOutcome(r);
      router.refresh();
    });

  const destructive = a.risk === "destructive";
  const decided = outcome?.ok;

  return (
    <li className="window flex flex-col gap-3 p-5" aria-label={a.summary}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[1.0625rem] leading-snug font-semibold">{a.summary}</p>
        <span className="text-sm text-ink-soft">{ago(a.createdAt)}</span>
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft">
        <Link href={`/apps/${a.connectorId}/activity`}>{a.connectorName}</Link>
        <span>{a.actionTitle ?? "Deleted action"}</span>
        {a.risk && <RiskLabel risk={a.risk} />}
        <span className="font-mono">{a.shortId}</span>
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer text-signal">Exact request</summary>
        <pre className="bevel-in mt-2 overflow-x-auto p-3 font-mono text-xs">{JSON.stringify(a.input, null, 2)}</pre>
      </details>

      {!decided && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            onClick={() => {
              if (destructive && !confirm(`Approve this destructive action?\n\n${a.summary}\n\nIt runs once, right away, and may not be reversible.`)) return;
              decide(approveAction);
            }}
          >
            {pending ? "Working…" : "Approve and run"}
          </button>
          <button type="button" className="btn" disabled={pending} onClick={() => decide(rejectAction)}>
            Reject
          </button>
          {destructive && <span className="text-sm text-alarm">Destructive: check the exact request first.</span>}
        </div>
      )}

      {outcome && !outcome.ok && (
        <p role="alert" className="text-sm text-alarm">
          {outcome.error}
        </p>
      )}
      {outcome?.ok && outcome.decision === "rejected" && (
        <p role="status">
          <Stamp tone="quiet">Rejected</Stamp> <span className="text-sm">Nothing was sent to {a.connectorName}.</span>
        </p>
      )}
      {outcome?.ok && outcome.decision === "approved" && (
        <div role="status" className="flex flex-col gap-2">
          <p>
            {outcome.status === "success" ? <Stamp tone="ok">Approved · done</Stamp> : <Stamp tone="alarm">Approved · failed</Stamp>}{" "}
            <span className="text-sm">
              {outcome.status === "success" ? "It ran once." : outcome.reason}
              {outcome.httpStatus ? ` HTTP ${outcome.httpStatus}.` : ""}
            </span>
          </p>
          {outcome.preview && (
            <details className="text-sm">
              <summary className="cursor-pointer text-signal">What {a.connectorName} sent back</summary>
              <div className="mt-2">
                <ResultView data={outcome.preview} />
              </div>
            </details>
          )}
        </div>
      )}
    </li>
  );
}
