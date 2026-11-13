import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";
import type { HealthStatus } from "@/server/health/health";
import { ownedConnector } from "@/server/auth/guard";
import { getSetupState } from "@/server/connectors/setup-state";
import { AppTitle } from "./app-title";
import { SetupPanel } from "./setup-panel";
import { Monogram, StatusDot, Tag } from "./ui";

/** Tabs in the order of the process. */
const TABS = [
  { key: "actions", label: "Actions", href: (id: string) => `/apps/${id}/review` },
  { key: "settings", label: "Connection", href: (id: string) => `/apps/${id}/connect` },
  { key: "endpoint", label: "Publish", href: (id: string) => `/apps/${id}/published` },
  { key: "console", label: "Test console", href: (id: string) => `/apps/${id}/console` },
  { key: "health", label: "Health", href: (id: string) => `/apps/${id}/health` },
  { key: "activity", label: "Activity", href: (id: string) => `/apps/${id}/activity` },
] as const;

export type AppTabKey = (typeof TABS)[number]["key"];

/** Breadcrumb label for an app page (resolves the name from the route). */
export async function AppCrumb({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await ownedConnector(id);
  return <>{c?.name ?? "App"}</>;
}

/**
 * Every app page: name + status, underline tabs, then the page content with
 * the Setup panel beside it (below it on small screens).
 */
export async function AppFrame({ id, current, children }: { id: string; current: AppTabKey; children: ReactNode }) {
  if (!z.uuid().safeParse(id).success) notFound();
  const c = await ownedConnector(id);
  if (!c) notFound();
  const setup = await getSetupState(id);
  if (!setup) notFound();

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Monogram name={c.name} size={44} />
        <div className="min-w-0 flex-1">
          <AppTitle id={id} name={c.name} />
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft">
            {c.status === "published" ? <StatusDot tone="ok">Published</StatusDot> : <StatusDot tone="quiet">Not published yet</StatusDot>}
            {setup.needsReconnect && <Tag tone="red">Needs reconnect</Tag>}
            {setup.draftHasChanges && <Tag tone="orange">Unpublished changes</Tag>}
            <span>
              {setup.toolsOn} of {setup.actionsTotal} actions on
            </span>
          </p>
        </div>
      </div>

      <nav aria-label={`${c.name} sections`} className="tabs">
        {TABS.map((t) => (
          <Link key={t.key} href={t.href(id)} aria-current={t.key === current ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="order-2 flex min-w-0 flex-col gap-5 lg:order-1">{children}</div>
        {/* On narrow screens the panel leads while setup is unfinished, then moves below the content. */}
        <aside className={`${setup?.next ? "order-1" : "order-3"} lg:sticky lg:top-20 lg:order-2`}>
          <SetupPanel state={setup} />
        </aside>
      </div>
    </>
  );
}

export function HealthLabel({ status }: { status: HealthStatus }) {
  switch (status) {
    case "healthy":
      return <StatusDot tone="ok">Healthy</StatusDot>;
    case "needs_reconnect":
      return <StatusDot tone="alarm">Needs reconnect</StatusDot>;
    case "failing":
      return <StatusDot tone="alarm">Failing</StatusDot>;
    case "no_calls":
      return <StatusDot tone="quiet">No calls yet</StatusDot>;
    case "not_connected":
      return <StatusDot tone="quiet">Not connected</StatusDot>;
  }
}
