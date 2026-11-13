import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { AppShell } from "@/components/app-shell";
import { AppCrumb, AppFrame, HealthLabel } from "@/components/app-tabs";
import { ButtonLink, Notice, Window } from "@/components/ui";
import { ownedConnector } from "@/server/auth/guard";
import { REASON_LABEL, healthDetail } from "@/server/health/health";

export const metadata = { title: "Health · BYOMCP" };

export default function HealthPage({ params }: PageProps<"/apps/[id]/health">) {
  return (
    <AppShell crumbs={[{ label: <Suspense fallback="App"><AppCrumb params={params} /></Suspense> }]}>
      <Suspense fallback={<p className="text-ink-soft">Loading…</p>}>
        <Health params={params} />
      </Suspense>
    </AppShell>
  );
}

const when = (d: Date | null | undefined) => (d ? d.toLocaleString() : "Never");

async function Health({ params }: Pick<PageProps<"/apps/[id]/health">, "params">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const connector = await ownedConnector(id);
  if (!connector) notFound();
  const h = await healthDetail(id);

  return (
    <AppFrame id={id} current="health">

      {h.status === "needs_reconnect" && (
        <Notice tone="alarm">
          <p className="font-semibold">{connector.name} rejected your saved key.</p>
          <p className="text-sm">
            Your AI employee can&apos;t use it until you reconnect. Check the key is still valid and has access to what the actions need,
            then save it again.
          </p>
          <div className="mt-2">
            <ButtonLink href={`/apps/${id}/connect`} primary small>
              Reconnect {connector.name}
            </ButtonLink>
          </div>
        </Notice>
      )}
      {h.status === "failing" && (
        <Notice tone="alarm">
          <p className="font-semibold">Most recent calls failed.</p>
          <p className="text-sm">
            Last problem: {h.lastFailure ? `${REASON_LABEL[h.lastFailure.status] ?? h.lastFailure.status}${h.lastFailure.reason ? `: ${h.lastFailure.reason}` : ""}` : "unknown"}.{" "}
            <Link href={`/apps/${id}/activity`}>See the activity</Link>.
          </p>
        </Notice>
      )}

      <Window title="Health" titleRight={<HealthLabel status={h.status} />} status={["Based on the last 5 calls and the saved key", "Updated when you load the page"]}>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Last success" value={when(h.lastSuccess?.at)} />
          <Stat label="Calls, last 24 h" value={String(h.calls24h)} />
          <Stat label="Calls, last 7 days" value={String(h.calls7d)} />
          <Stat label="Success rate, 7 days" value={h.successRate7d === null ? "—" : `${Math.round(h.successRate7d * 100)}%`} />
        </dl>
        {h.lastVerifiedAt && <p className="mt-4 text-sm text-ink-soft">The saved key last worked {when(h.lastVerifiedAt)}.</p>}
      </Window>

      <Window title="Results, last 7 days">
        {h.byStatus7d.length === 0 ? (
          <p className="text-ink-soft">No calls yet. Try an action on the Actions tab, or connect an AI employee.</p>
        ) : (
          <ul className="divide-y divide-[var(--separator)]">
            {h.byStatus7d.map((r) => (
              <li key={r.status} className="flex items-center justify-between py-2">
                <span>{REASON_LABEL[r.status] ?? r.status}</span>
                <Link href={`/apps/${id}/activity?status=${r.status}`} className="font-semibold tabular-nums">
                  {r.count}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Window>

      {h.perTool.length > 0 && (
        <Window title="Each tool's last result">
          <ul className="divide-y divide-[var(--separator)]">
            {h.perTool.map((t) => (
              <li key={t.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="font-mono">{t.key}</span>
                <span className={t.status === "success" ? "text-ok" : "text-alarm"}>
                  {REASON_LABEL[t.status] ?? t.status}
                  {t.httpStatus ? ` · HTTP ${t.httpStatus}` : ""}
                </span>
                <span className="text-ink-soft">{when(t.at)}</span>
              </li>
            ))}
          </ul>
        </Window>
      )}
    </AppFrame>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="text-[1.25rem] font-semibold tracking-tight tabular-nums">{value}</dd>
    </div>
  );
}
