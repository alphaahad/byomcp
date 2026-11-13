"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ImportProgress } from "@/server/import/run-ai-import";

const STAGE_LABEL: Record<ImportProgress["stage"], string> = {
  fetching: "Reading pages",
  extracting: "Finding actions with AI",
  merging: "Putting it together",
  done: "Done",
  failed: "Stopped",
};

function formatCost(p: ImportProgress) {
  if (!p.costKnown) return "unknown (this model isn't in our price list)";
  const c = p.costUsd ?? 0;
  return `$${c.toFixed(c > 0 && c < 0.01 ? 4 : 2)}`;
}

/** 0..1 overall progress: fetching is the first 30%, AI the next 65%, merging the rest. */
function fraction(p: ImportProgress): number {
  if (p.stage === "done") return 1;
  const fetch = p.pagesPlanned ? p.pagesRead / p.pagesPlanned : p.stage === "fetching" ? 0 : 1;
  const ai = p.chunksTotal ? p.chunksDone / p.chunksTotal : 0;
  if (p.stage === "fetching") return 0.3 * fetch;
  if (p.stage === "extracting") return 0.3 + 0.65 * ai;
  if (p.stage === "merging") return 0.97;
  return 0;
}

const SEGMENTS = 24;

export function ImportProgressView({ initial }: { initial: ImportProgress }) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const [netError, setNetError] = useState<string | null>(null);

  useEffect(() => {
    if (p.stage === "done") {
      router.replace(`/apps/${p.connectorId}/review?new=1`);
      return;
    }
    if (p.stage === "failed") return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/imports/${p.jobId}/step`, { method: "POST" });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setNetError(body.error ?? "Something went wrong. Reload the page to continue.");
          return;
        }
        setNetError(null);
        setP(body as ImportProgress);
      } catch {
        if (cancelled) return;
        setNetError("Lost connection. We'll keep trying.");
        setP((prev) => ({ ...prev })); // re-run the effect to retry
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [p, router]);

  const running = p.stage !== "done" && p.stage !== "failed";
  const filled = Math.round(fraction(p) * SEGMENTS);

  return (
    <section className="window" aria-labelledby="import-title">
      <div className="titlebar">
        <h2 id="import-title">Progress</h2>
      </div>
      <div className="flex flex-col gap-4 px-5 pt-3 pb-5" aria-live="polite">
        <p className="text-lg font-bold">{STAGE_LABEL[p.stage]}…</p>
        <div
          className="progress bevel-in"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction(p) * 100)}
          aria-label="Import progress"
        >
          {Array.from({ length: filled }, (_, i) => (
            <span key={i} />
          ))}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
          <dt>Pages read</dt>
          <dd>
            {p.pagesRead}
            {p.pagesPlanned > p.pagesRead ? ` of ${p.pagesPlanned}` : ""}
          </dd>
          <dt>Parts checked by AI</dt>
          <dd>{p.chunksTotal ? `${p.chunksDone} of ${p.chunksTotal}` : "Not started"}</dd>
          <dt>Actions found</dt>
          <dd>{p.actionsFound}</dd>
          <dt>Estimated AI cost</dt>
          <dd>{formatCost(p)}</dd>
        </dl>
        {running && <p className="text-sm text-ink-soft">Keep this page open while we read the docs. It usually takes under a minute.</p>}
        {netError && (
          <p role="alert" className="text-alarm">
            ⚠ {netError}
          </p>
        )}

        {p.openApiLinks.length > 0 && (
          <div className="bevel-in flex flex-col gap-2 p-3">
            <p>ℹ These docs link to an OpenAPI file. Importing that instead is free and usually more complete.</p>
            <Link className="btn btn-sm self-start" href={`/apps/new?source=openapi&url=${encodeURIComponent(p.openApiLinks[0])}`}>
              Use the OpenAPI file instead
            </Link>
          </div>
        )}

        {p.stage === "failed" && (
          <div className="flex flex-col gap-3">
            <p role="alert" className="bevel-in p-3">
              <span className="text-alarm">⚠ </span>
              {p.error}
            </p>
            <Link href="/apps/new" className="btn btn-primary self-start">
              Try again
            </Link>
          </div>
        )}
      </div>
      <div className="statusbar">
        <span>{STAGE_LABEL[p.stage]}</span>
        <span>{p.actionsFound} actions</span>
        <span>Est. AI cost {formatCost(p)}</span>
      </div>
    </section>
  );
}
