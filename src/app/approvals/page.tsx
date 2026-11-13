import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { PageHeader, Stamp, Window } from "@/components/ui";
import { listApprovals } from "@/server/approvals/approvals";
import { requireWorkspace } from "@/server/auth/guard";
import { env } from "@/server/env";
import { getNotifyEmail } from "@/server/notify/email";
import { ApprovalCard } from "./approval-card";
import { NotifyForm } from "./notify-form";

export const metadata = { title: "Approvals · BYOMCP" };

export default function ApprovalsPage() {
  return (
    <AppShell crumbs={[{ label: "Approvals" }]}>
      <PageHeader
        title="Approvals"
        lead="When your AI employee asks to change data in an app, the request waits here. Nothing has been sent yet: approve to run it once, or reject it."
      />
      <Suspense fallback={<p className="text-ink-soft">Loading…</p>}>
        <Pending />
      </Suspense>
      <Suspense fallback={null}>
        <Recent />
      </Suspense>
      <Suspense fallback={null}>
        <Notify />
      </Suspense>
    </AppShell>
  );
}

async function Pending() {
  await connection();
  const ws = await requireWorkspace();
  const pending = await listApprovals({ workspaceId: ws.id, pending: true });
  if (pending.length === 0) {
    return (
      <Window title="All clear">
        <p className="text-ink-soft">Nothing is waiting. When an AI employee asks to change data in one of your apps, the request appears here with exactly what it will do.</p>
      </Window>
    );
  }
  return (
    <ul className="flex flex-col gap-3" aria-label="Waiting for approval">
      {pending.map((a) => (
        <ApprovalCard
          key={a.id}
          a={{
            id: a.id,
            shortId: a.shortId,
            summary: a.summary,
            input: a.input,
            createdAt: a.createdAt.toISOString(),
            connectorId: a.connectorId,
            connectorName: a.connectorName,
            actionTitle: a.actionTitle,
            risk: a.risk,
          }}
        />
      ))}
    </ul>
  );
}

async function Recent() {
  await connection();
  const ws = await requireWorkspace();
  const recent = await listApprovals({ workspaceId: ws.id, pending: false, limit: 20 });
  if (recent.length === 0) return null;
  return (
    <Window title="Recently decided" status={["Requests expire after 24 hours if nobody decides"]}>
      <ul className="divide-y divide-[var(--separator)]">
        {recent.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
            {a.status === "approved" ? (
              a.result?.status === "success" ? (
                <Stamp tone="ok">Approved · done</Stamp>
              ) : (
                <Stamp tone="alarm">Approved · failed</Stamp>
              )
            ) : a.status === "rejected" ? (
              <Stamp tone="quiet">Rejected</Stamp>
            ) : (
              <Stamp tone="quiet">Expired</Stamp>
            )}
            <span className="min-w-[12rem] flex-1">{a.summary}</span>
            <Link href={`/apps/${a.connectorId}/activity`} className="text-ink-soft">
              {a.decidedAt?.toLocaleString()}
            </Link>
          </li>
        ))}
      </ul>
    </Window>
  );
}

async function Notify() {
  await connection();
  const ws = await requireWorkspace();
  return <NotifyForm current={await getNotifyEmail(ws.id)} available={!!env().RESEND_API_KEY} />;
}
