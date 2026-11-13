import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { AppShell } from "@/components/app-shell";
import { AppCrumb, AppFrame } from "@/components/app-tabs";
import { Stamp, Window } from "@/components/ui";
import { ownedConnector } from "@/server/auth/guard";
import { REASON_LABEL, listCalls, type CallLogRow } from "@/server/health/health";

export const metadata = { title: "Activity · BYOMCP" };

const SOURCE_LABEL = { mcp: "AI employee", try_it: "Try it", approval: "Approval" } as const;
const FILTERS = ["", "success", "pending_approval", "auth_failed", "transient_failed", "request_error", "empty_or_invalid", "validation_error", "rejected"];
const PAGE = 50;

export default function ActivityPage({ params, searchParams }: PageProps<"/apps/[id]/activity">) {
  return (
    <AppShell wide crumbs={[{ label: <Suspense fallback="App"><AppCrumb params={params} /></Suspense> }]}>
      <Suspense fallback={<p className="text-ink-soft">Loading…</p>}>
        <Activity params={params} searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}

function ResultLabel({ status }: { status: CallLogRow["status"] }) {
  const label = REASON_LABEL[status] ?? status;
  if (status === "success") return <Stamp tone="ok">{label}</Stamp>;
  if (status === "pending_approval" || status === "rejected" || status === "validation_error") return <Stamp tone="quiet">{label}</Stamp>;
  return <Stamp tone="alarm">{label}</Stamp>;
}

async function Activity({ params, searchParams }: Pick<PageProps<"/apps/[id]/activity">, "params" | "searchParams">) {
  const { id } = await params;
  const sp = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const connector = await ownedConnector(id);
  if (!connector) notFound();
  const status = typeof sp.status === "string" ? sp.status : "";
  const beforeRaw = typeof sp.before === "string" ? new Date(sp.before) : undefined;
  const before = beforeRaw && !Number.isNaN(beforeRaw.getTime()) ? beforeRaw : undefined;
  const calls = await listCalls(id, { status: status || undefined, before, limit: PAGE });
  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <AppFrame id={id} current="activity">
      <Window title="Activity" status={["Inputs are shown with secrets hidden", "Newest first"]}>
        <div className="flex flex-col gap-4">
          <nav aria-label="Filter by result" className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <Link
                key={f || "all"}
                href={`/apps/${id}/activity${qs({ status: f })}`}
                aria-current={status === f ? "true" : undefined}
                className={`rounded-full px-3 py-1 text-sm no-underline hover:no-underline ${
                  status === f ? "bg-[var(--ink)] font-semibold text-[var(--surface)]" : "bg-[var(--fill)] text-ink"
                }`}
              >
                {f ? REASON_LABEL[f] : "All"}
              </Link>
            ))}
          </nav>

          {calls.length === 0 ? (
            <p className="text-ink-soft">{status ? "No calls with this result." : "No calls yet. Try an action, or connect an AI employee to the MCP server."}</p>
          ) : (
            <ul className="divide-y divide-[var(--separator)]">
              {calls.map((c) => (
                <li key={c.id} className="py-2.5">
                  <details>
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="w-40 shrink-0 text-sm text-ink-soft tabular-nums">{c.createdAt.toLocaleString()}</span>
                      <span className="min-w-36 font-mono text-sm">{c.actionKey}</span>
                      <ResultLabel status={c.status} />
                      <span className="text-sm text-ink-soft">
                        {SOURCE_LABEL[c.source]}
                        {c.httpStatus ? ` · HTTP ${c.httpStatus}` : ""}
                        {c.durationMs !== null ? ` · ${c.durationMs} ms` : ""}
                        {c.attempts > 1 ? ` · ${c.attempts} attempts` : ""}
                      </span>
                      {c.failureReason && <span className="w-full text-sm sm:w-auto sm:flex-1">{c.failureReason}</span>}
                    </summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div>
                        <p className="text-xs font-semibold text-ink-soft">Input</p>
                        <pre className="bevel-in mt-1 max-h-60 overflow-auto p-2 font-mono text-xs">{JSON.stringify(c.input ?? {}, null, 2)}</pre>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-ink-soft">Response (start)</p>
                        <pre className="bevel-in mt-1 max-h-60 overflow-auto p-2 font-mono text-xs whitespace-pre-wrap">{c.responsePreview || "—"}</pre>
                      </div>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}

          {calls.length === PAGE && (
            <div>
              <Link className="btn btn-sm" href={`/apps/${id}/activity${qs({ status, before: calls[calls.length - 1].createdAt.toISOString() })}`}>
                Show older
              </Link>
            </div>
          )}
        </div>
      </Window>
    </AppFrame>
  );
}
