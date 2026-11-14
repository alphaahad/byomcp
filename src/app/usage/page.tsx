import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { PageHeader, Tag, Window, formatUsd } from "@/components/ui";
import { requireOwner } from "@/server/auth/guard";
import { USAGE_DAYS, usageByDay, usageByWorkspace, usageTotals } from "@/server/workspaces/usage";
import { DailyCharts, Stats, fmt } from "./usage-parts";

export const metadata = { title: "Usage · BYOMCP" };

export default function UsagePage() {
  return (
    <AppShell crumbs={[{ label: "Usage" }]}>
      <PageHeader
        title="Usage"
        lead="What every workspace did, across all of them. Only you see this page. It shows activity, never what was sent or returned, keys or tokens."
      />
      <Suspense fallback={<p className="text-ink-soft">Loading usage…</p>}>
        <Usage />
      </Suspense>
    </AppShell>
  );
}

async function Usage() {
  await connection();
  await requireOwner();
  const [t, days, workspaces] = await Promise.all([usageTotals(), usageByDay(), usageByWorkspace()]);
  const failRate = t.calls ? Math.round((t.failedCalls / t.calls) * 100) : 0;

  return (
    <div className="flex flex-col gap-5">
      <Window title="All workspaces" status={["Costs are estimates at Google's list prices; on the free tier nobody is charged", "Days are India time"]}>
        <div className="flex flex-col gap-4">
          <Stats
            items={[
              { value: t.workspaces, label: "Workspaces" },
              { value: `${t.active7d} / ${t.active30d}`, label: "Active, 7 / 30 days" },
              { value: `${t.apps} (${t.published} live)`, label: "Apps" },
              { value: t.signIns30d, label: `Sign-ins, ${USAGE_DAYS} days` },
            ]}
          />
          <Stats
            items={[
              { value: t.calls, label: `Calls (${t.calls7d} in 7 days)` },
              { value: `${t.failedCalls} (${failRate}%)`, label: "Failed calls" },
              { value: t.mcpCalls, label: "From AI employees" },
              {
                value: `${t.approvals.pending} / ${t.approvals.approved} / ${t.approvals.rejected + t.approvals.expired}`,
                label: "Approvals: waiting / approved / not run",
              },
            ]}
          />
          <Stats
            items={[
              { value: t.aiImports, label: "AI imports" },
              { value: t.chats, label: "Test-chat messages" },
              { value: (t.aiTokens + t.chatTokens).toLocaleString("en-GB"), label: "AI tokens" },
              { value: formatUsd(t.aiCostUsd), label: "Est. AI cost" },
            ]}
          />
        </div>
      </Window>

      <Window title={`Last ${USAGE_DAYS} days`}>
        <DailyCharts days={days} />
      </Window>

      <Window title="By workspace" status={["Most recently active first", "Open a workspace for its apps and activity"]}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b border-[var(--separator)] text-left text-xs font-medium tracking-wide text-ink-soft">
                <th className="pr-3 pb-2 font-medium">Workspace</th>
                <th className="pr-3 pb-2 font-medium">Last active</th>
                <th className="pr-3 pb-2 text-right font-medium">Sign-ins</th>
                <th className="pr-3 pb-2 text-right font-medium">Apps (live)</th>
                <th className="pr-3 pb-2 text-right font-medium">Calls (7 days)</th>
                <th className="pr-3 pb-2 text-right font-medium">Failed</th>
                <th className="pr-3 pb-2 text-right font-medium">Waiting</th>
                <th className="pr-3 pb-2 text-right font-medium">AI imports</th>
                <th className="pr-3 pb-2 text-right font-medium">Chats</th>
                <th className="pb-2 text-right font-medium">Est. AI cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--separator)]">
              {workspaces.map((w) => (
                <tr key={w.id} className={w.lastActiveAt ? "" : "text-ink-soft"}>
                  <td className="py-2 pr-3">
                    <Link href={`/usage/${w.id}`} className="font-medium">
                      {w.label}
                    </Link>{" "}
                    {w.isOwner && <Tag tone="violet">You</Tag>} {w.revoked && <Tag tone="red">Revoked</Tag>}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">{fmt(w.lastActiveAt)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{w.signIns}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {w.apps} ({w.published})
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {w.calls} ({w.calls7d})
                  </td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${w.failedCalls ? "text-alarm" : ""}`}>{w.failedCalls}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{w.pendingApprovals}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{w.aiImports}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{w.chats}</td>
                  <td className="py-2 text-right tabular-nums">{formatUsd(w.aiCostUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Window>

      <p className="text-xs text-ink-soft">
        Sign-ins are logged from 15 Nov 2026; before that, only each workspace&apos;s latest sign-in was kept. Deleted workspaces take their history
        with them.
      </p>
    </div>
  );
}
