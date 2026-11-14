import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { logout } from "@/app/login/actions";
import { countPending } from "@/server/approvals/approvals";
import { requireWorkspace } from "@/server/auth/guard";
import { listConnectors } from "@/server/connectors/queries";
import { totalAiSpend } from "@/server/connectors/setup-state";
import { IconBell, IconBook, IconChart, IconHome, IconInbox, IconLogout, IconMenu, IconPlus, IconUsers } from "./icons";
import { NavLink } from "./nav-link";
import { ThemeToggle } from "./theme-toggle";
import { Monogram, formatUsd } from "./ui";

export type Crumb = { label: ReactNode; href?: string };

/**
 * App frame in the UnleashX layout: left sidebar (brand, workspace, nav,
 * your apps, AI spend card, sign out) + top bar (breadcrumb, How it works,
 * approvals bell). On small screens the sidebar becomes a menu.
 */
export function AppShell({ children, wide, crumbs = [] }: { children: ReactNode; wide?: boolean; crumbs?: Crumb[] }) {
  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-[var(--surface)] focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-[var(--separator)] bg-[var(--surface)] lg:flex">
        <SidebarContent />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-[var(--separator)] bg-[var(--surface)] px-4 sm:px-6">
          <details className="relative lg:hidden">
            <summary className="btn btn-sm list-none" aria-label="Menu">
              <IconMenu size={18} />
            </summary>
            <div className="window absolute top-11 left-0 z-30 flex w-72 flex-col">
              <SidebarContent />
            </div>
          </details>
          <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
            <ol className="flex min-w-0 items-center gap-2 text-[0.9375rem]">
              <li className={crumbs.length ? "text-ink-soft" : "font-medium"}>
                {crumbs.length ? (
                  <Link href="/" className="text-ink-soft hover:text-ink">
                    Home
                  </Link>
                ) : (
                  "Home"
                )}
              </li>
              {crumbs.map((c, i) => (
                <li key={i} className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className="text-ink-soft">
                    ›
                  </span>
                  {c.href && i < crumbs.length - 1 ? (
                    <Link href={c.href} className="truncate text-ink-soft hover:text-ink">
                      {c.label}
                    </Link>
                  ) : (
                    <span className="truncate font-medium" aria-current="page">
                      {c.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
          <Link href="/how-it-works" className="btn btn-sm hidden sm:inline-flex">
            <IconBook size={16} /> How it works
          </Link>
          <Link href="/approvals" className="btn btn-sm relative px-2" aria-label="Approvals">
            <IconBell size={18} />
            <Suspense fallback={null}>
              <PendingBadge floating />
            </Suspense>
          </Link>
        </header>

        <main id="main" className={`mx-auto flex w-full flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 ${wide ? "max-w-7xl" : "max-w-5xl"}`}>
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarContent() {
  return (
    <>
      <div className="flex items-center gap-2 px-5 pt-5 pb-4">
        <span aria-hidden className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[var(--signal)] text-sm font-bold text-[var(--signal-ink)]">
          B
        </span>
        <Link href="/" className="text-[1.25rem] font-bold tracking-tight text-ink no-underline hover:no-underline">
          BYOMCP
        </Link>
      </div>
      <Suspense fallback={<div className="mx-4 mb-3 h-9 rounded-[var(--radius-sm)] bg-[var(--fill)]" />}>
        <WorkspaceBadge />
      </Suspense>

      <nav aria-label="Main" className="flex flex-col gap-0.5 px-3">
        <NavLink href="/">
          <IconHome size={18} className="text-signal" /> Home
        </NavLink>
        <NavLink href="/apps/new" match="/apps/new">
          <IconPlus size={18} className="text-signal" /> Add an app
        </NavLink>
        <NavLink href="/approvals" match="/approvals">
          <IconInbox size={18} className="text-signal" /> Approvals
          <Suspense fallback={null}>
            <PendingBadge />
          </Suspense>
        </NavLink>
        <NavLink href="/how-it-works" match="/how-it-works">
          <IconBook size={18} className="text-signal" /> How it works
        </NavLink>
        <Suspense fallback={null}>
          <OwnerLinks />
        </Suspense>
      </nav>

      <p className="mt-5 mb-1 px-6 text-xs font-medium tracking-wide text-ink-soft">YOUR APPS</p>
      <div className="min-h-0 flex-1 overflow-y-auto px-3">
        <Suspense fallback={<p className="px-3 text-sm text-ink-soft">Loading…</p>}>
          <AppLinks />
        </Suspense>
      </div>

      <div className="flex flex-col gap-2 border-t border-[var(--separator)] p-3">
        <Suspense fallback={null}>
          <SpendCard />
        </Suspense>
        <ThemeToggle />
        <form action={logout}>
          <button type="submit" className="navitem w-full text-ink-soft">
            <IconLogout size={18} /> Sign out
          </button>
        </form>
      </div>
    </>
  );
}

async function WorkspaceBadge() {
  await connection();
  const ws = await requireWorkspace();
  return (
    <div className="mx-4 mb-3 flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--fill)] px-3 py-2 text-sm">
      <span aria-hidden className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--separator)] bg-[var(--surface)] text-[0.65rem] font-semibold">
        {ws.label.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 truncate font-medium">{ws.label}</span>
      {ws.isOwner && <span className="ml-auto text-xs text-ink-soft">Owner</span>}
    </div>
  );
}

/** Only the owner sees the Workspaces and Usage pages. */
async function OwnerLinks() {
  await connection();
  const ws = await requireWorkspace();
  if (!ws.isOwner) return null;
  return (
    <>
      <NavLink href="/workspaces" match="/workspaces">
        <IconUsers size={18} className="text-signal" /> Workspaces
      </NavLink>
      <NavLink href="/usage" match="/usage">
        <IconChart size={18} className="text-signal" /> Usage
      </NavLink>
    </>
  );
}

async function AppLinks() {
  await connection();
  const ws = await requireWorkspace();
  const apps = await listConnectors(ws.id);
  if (apps.length === 0) return <p className="px-3 py-1 text-sm text-ink-soft">None yet. Add your first app above.</p>;
  return (
    <ul className="flex flex-col gap-0.5">
      {apps.map((a) => (
        <li key={a.id}>
          <NavLink href={`/apps/${a.id}/review`} match={`/apps/${a.id}`}>
            <Monogram name={a.name} size={22} />
            <span className="min-w-0 flex-1 truncate">{a.name}</span>
            {a.status === "published" && <span aria-label="Published" className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

async function SpendCard() {
  await connection();
  const ws = await requireWorkspace();
  const spend = await totalAiSpend(ws.id);
  return (
    <div className="rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--signal)_35%,transparent)] bg-[var(--signal-tint)] p-3">
      <p className="text-xs font-semibold tracking-wide text-signal">ESTIMATED AI COST</p>
      <p className="mt-0.5 text-[1.125rem] font-semibold">
        {formatUsd(spend)} <span className="text-sm font-normal text-ink-soft">so far</span>
      </p>
      <p className="text-xs text-ink-soft">Reading docs and test chats, at Google&apos;s list prices. Your apps run with no AI: $0 per call.</p>
    </div>
  );
}

async function PendingBadge({ floating }: { floating?: boolean }) {
  await connection();
  const ws = await requireWorkspace();
  const n = await countPending(ws.id);
  if (n === 0) return null;
  return (
    <span
      className={`min-w-5 rounded-full bg-[var(--badge)] px-1.5 text-center text-xs leading-5 font-semibold text-white ${floating ? "absolute -top-1.5 -right-1.5" : "ml-auto"}`}
      aria-label={`${n} waiting`}
    >
      {n}
    </span>
  );
}
