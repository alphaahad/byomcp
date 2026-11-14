import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { AppShell } from "@/components/app-shell";
import { PageHeader, StatusDot, Tag, Window, formatUsd } from "@/components/ui";
import { requireOwner } from "@/server/auth/guard";
import { USAGE_DAYS, usageByDay, usageByWorkspace, workspaceUsageDetail } from "@/server/workspaces/usage";
import { DailyCharts, SOURCE_LABEL, SOURCE_TYPE_LABEL, STATUS_LABEL, Stats, fmt } from "../usage-parts";

export const metadata = { title: "Workspace usage · BYOMCP" };

export default function WorkspaceUsagePage({ params }: PageProps<"/usage/[workspaceId]">) {
  return (
    <AppShell crumbs={[{ label: "Usage", href: "/usage" }, { label: "Workspace" }]}>
      <Suspense fallback={<p className="text-ink-soft">Loading usage…</p>}>
        <Detail params={params} />
      </Suspense>
    </AppShell>
  );
}

const Empty = ({ children }: { children: string }) => <p className="text-sm text-ink-soft">{children}</p>;
const th = "pr-3 pb-2 font-medium";

async function Detail({ params }: Pick<PageProps<"/usage/[workspaceId]">, "params">) {
  await connection();
  await requireOwner();
  const { workspaceId } = await params;
  if (!z.uuid().safeParse(workspaceId).success) notFound();
  const all = await usageByWorkspace();
  const w = all.find((x) => x.id === workspaceId);
  if (!w) notFound();
  const [days, d] = await Promise.all([usageByDay(workspaceId), workspaceUsageDetail(workspaceId)]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={
          <>
            {w.label} {w.isOwner && <Tag tone="violet">You</Tag>} {w.revoked && <Tag tone="red">Revoked</Tag>}
          </>
        }
        lead={`Created ${fmt(w.createdAt, "date")} · last active ${fmt(w.lastActiveAt)}. Activity only: never what was sent or returned, keys or tokens.`}
      />

      <Window title="Totals">
        <Stats
          items={[
            { value: w.signIns, label: "Sign-ins" },
            { value: `${w.apps} (${w.published} live)`, label: "Apps" },
            { value: `${w.calls} (${w.failedCalls} failed)`, label: "Calls" },
            { value: `${w.aiImports} / ${w.chats}`, label: "AI imports / chats" },
            { value: formatUsd(w.aiCostUsd), label: "Est. AI cost" },
          ]}
        />
      </Window>

      <Window title={`Last ${USAGE_DAYS} days`}>
        <DailyCharts days={days} />
      </Window>

      <Window title="Apps">
        {d.apps.length === 0 ? (
          <Empty>No apps yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-[var(--separator)] text-left text-xs tracking-wide text-ink-soft">
                  <th className={th}>App</th>
                  <th className={th}>Started from</th>
                  <th className={th}>Created</th>
                  <th className={`${th} text-right`}>Actions on</th>
                  <th className={`${th} text-right`}>Calls (failed)</th>
                  <th className="pb-2 font-medium">Last call</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--separator)]">
                {d.apps.map((a) => (
                  <tr key={a.id}>
                    <td className="py-2 pr-3">
                      <span className="font-medium">{a.name}</span> {a.status === "published" ? <Tag tone="green">Live</Tag> : <Tag tone="grey">Draft</Tag>}
                    </td>
                    <td className="py-2 pr-3">{a.sourceType ? (SOURCE_TYPE_LABEL[a.sourceType] ?? a.sourceType) : "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{fmt(a.createdAt)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {a.enabled} of {a.actions}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {a.calls} ({a.failedCalls})
                    </td>
                    <td className="py-2 whitespace-nowrap">{fmt(a.lastCallAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Window>

      <Window title="Recent calls" status={["Latest 50", "Inputs and results are never shown here"]}>
        {d.calls.length === 0 ? (
          <Empty>No calls yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-[var(--separator)] text-left text-xs tracking-wide text-ink-soft">
                  <th className={th}>When</th>
                  <th className={th}>App</th>
                  <th className={th}>Action</th>
                  <th className={th}>From</th>
                  <th className="pb-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--separator)]">
                {d.calls.map((c, i) => {
                  const s = STATUS_LABEL[c.status] ?? { text: c.status, tone: "quiet" as const };
                  return (
                    <tr key={i}>
                      <td className="py-2 pr-3 whitespace-nowrap">{fmt(c.at)}</td>
                      <td className="py-2 pr-3">{c.app}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{c.action}</td>
                      <td className="py-2 pr-3">{SOURCE_LABEL[c.source] ?? c.source}</td>
                      <td className="py-2">
                        <StatusDot tone={s.tone}>
                          {s.text}
                          {c.httpStatus ? ` · HTTP ${c.httpStatus}` : ""}
                          {c.durationMs != null ? ` · ${c.durationMs} ms` : ""}
                        </StatusDot>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Window>

      <div className="grid gap-5 lg:grid-cols-2">
        <Window title="Imports">
          {d.imports.length === 0 ? (
            <Empty>No imports yet.</Empty>
          ) : (
            <ul className="divide-y divide-[var(--separator)] text-sm">
              {d.imports.map((m, i) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
                  <span>
                    <span className="font-medium">{m.app}</span> · {SOURCE_TYPE_LABEL[m.sourceType] ?? m.sourceType} · {m.actions} actions
                  </span>
                  <span className="text-ink-soft tabular-nums">
                    {m.model ? `${m.tokens.toLocaleString("en-GB")} tokens · ${formatUsd(m.costUsd)} · ` : ""}
                    {fmt(m.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Window>

        <Window title="Test-chat messages">
          {d.chats.length === 0 ? (
            <Empty>No test-chat messages yet.</Empty>
          ) : (
            <ul className="divide-y divide-[var(--separator)] text-sm">
              {d.chats.map((c, i) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
                  <span>
                    <span className="font-medium">{c.app ?? "Deleted app"}</span> · {c.toolCalls} tool {c.toolCalls === 1 ? "call" : "calls"}
                  </span>
                  <span className="text-ink-soft tabular-nums">
                    {c.tokens.toLocaleString("en-GB")} tokens · {formatUsd(c.costUsd)} · {fmt(c.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Window>

        <Window title="Sign-ins" status={["Latest 20", "Logged from 15 Nov 2026"]}>
          {d.signIns.length === 0 ? (
            <Empty>Never signed in.</Empty>
          ) : (
            <ul className="divide-y divide-[var(--separator)] text-sm">
              {d.signIns.map((s, i) => (
                <li key={i} className="py-2 tabular-nums">
                  {fmt(s)}
                </li>
              ))}
            </ul>
          )}
        </Window>

        <Window title="Apps they asked for">
          {d.requests.length === 0 ? (
            <Empty>No requests.</Empty>
          ) : (
            <ul className="divide-y divide-[var(--separator)] text-sm">
              {d.requests.map((r, i) => (
                <li key={i} className="flex justify-between gap-3 py-2">
                  <span className="font-medium">{r.appName}</span>
                  <span className="text-ink-soft">{fmt(r.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Window>
      </div>
    </div>
  );
}
