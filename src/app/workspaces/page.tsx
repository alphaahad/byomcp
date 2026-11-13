import { connection } from "next/server";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { PageHeader, Window, formatUsd } from "@/components/ui";
import { requireOwner } from "@/server/auth/guard";
import { GUEST_AI_IMPORTS_PER_DAY, listAppRequests, listWorkspacesWithStats } from "@/server/workspaces/workspaces";
import { WorkspaceRow } from "./workspace-row";

export const metadata = { title: "Workspaces · BYOMCP" };

export default function WorkspacesPage() {
  return (
    <AppShell crumbs={[{ label: "Workspaces" }]}>
      <PageHeader
        title="Workspaces"
        lead="Each passcode opens its own workspace: separate apps, approvals and activity. Only you see this page."
      />
      <Suspense fallback={<p className="text-ink-soft">Loading…</p>}>
        <WorkspaceTable />
      </Suspense>
      <Suspense fallback={null}>
        <Requests />
      </Suspense>
    </AppShell>
  );
}

async function WorkspaceTable() {
  await connection();
  await requireOwner();
  const rows = await listWorkspacesWithStats();
  return (
    <Window
      status={[
        "Passcodes are stored only as hashes, so they can't be shown again",
        `Guests get ${GUEST_AI_IMPORTS_PER_DAY} AI imports a day`,
      ]}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-[var(--separator)] text-left text-xs font-medium tracking-wide text-ink-soft">
              <th className="pr-3 pb-2 font-medium">Workspace</th>
              <th className="pr-3 pb-2 font-medium">Last sign-in</th>
              <th className="pr-3 pb-2 text-right font-medium">Apps</th>
              <th className="pr-3 pb-2 text-right font-medium">Calls, 7 days</th>
              <th className="pr-3 pb-2 text-right font-medium">AI imports / chats · est. cost</th>
              <th className="pb-2">
                <span className="sr-only">Access</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--separator)]">
            {rows.map((w) => (
              <WorkspaceRow
                key={w.id}
                w={{
                  id: w.id,
                  label: w.label,
                  isOwner: w.isOwner,
                  revoked: !!w.revokedAt,
                  lastSignIn: w.lastSignInAt ? w.lastSignInAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "Never",
                  apps: w.apps,
                  published: w.published,
                  calls7d: w.calls7d,
                  aiImports: w.aiImports,
                  chatMessages: w.chatMessages,
                  aiCost: formatUsd(Number(w.aiCostUsd)),
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Window>
  );
}

/** Which apps people asked for: what to add to the catalog next. */
async function Requests() {
  await connection();
  await requireOwner();
  const rows = await listAppRequests();
  return (
    <Window title="Apps people asked for">
      {rows.length === 0 ? (
        <p className="text-sm text-ink-soft">No requests yet. They come from &quot;Don&apos;t see your app?&quot; under the app list on Home.</p>
      ) : (
        <ul className="divide-y divide-[var(--separator)] text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
              <span className="font-semibold">{r.appName}</span>
              <span className="text-ink-soft">{r.workspace}</span>
              <span className="text-xs text-ink-soft">{r.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
              {r.note && <span className="basis-full text-ink-soft">{r.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </Window>
  );
}
