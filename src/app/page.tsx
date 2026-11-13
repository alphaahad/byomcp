import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { HealthLabel } from "@/components/app-tabs";
import { IconArrowRight, IconDoc, IconPlug, IconRocket, IconShield } from "@/components/icons";
import { AiTag, ButtonLink, MetricRow, Monogram, Tag } from "@/components/ui";
import { pendingByConnector } from "@/server/approvals/approvals";
import { requireWorkspace } from "@/server/auth/guard";
import { listConnectors } from "@/server/connectors/queries";
import { callStats7d, getSetupState } from "@/server/connectors/setup-state";
import { healthSummary } from "@/server/health/health";
import { StartBox } from "./start-box";
import { Welcome } from "./welcome";

export const maxDuration = 60; // the start box imports whole specs

const STEPS = [
  {
    icon: IconDoc,
    title: "Pick the app",
    text: "Choose it from the list, or paste a link to its API docs. We list everything its API can do. AI reads docs pages once; OpenAPI files need no AI.",
    ai: { used: true, note: "docs pages only, est. $0.01" },
  },
  {
    icon: IconShield,
    title: "Choose what it can do",
    text: "Turn on only what your AI employee needs. Anything that changes data waits for your approval.",
    ai: { used: false },
  },
  {
    icon: IconPlug,
    title: "Connect and test",
    text: "Add your account's key (encrypted, never shown to AI), then run one action for real.",
    ai: { used: false },
  },
  {
    icon: IconRocket,
    title: "Publish",
    text: "Get an MCP address for UnleashX, Claude or any MCP client. Every call is logged.",
    ai: { used: false, note: "$0 per call" },
  },
] as const;

export default function Home() {
  return (
    <AppShell wide>
      <section className="flex flex-col items-center gap-6 pt-4 text-center sm:pt-10">
        <h1 className="max-w-3xl text-[2rem] leading-tight font-semibold tracking-tight sm:text-[2.5rem]">
          Give your AI employees <span className="text-signal">any app</span>.
          <br className="hidden sm:block" /> Pick the app, get a <span className="text-signal">safe connection</span> it can use.
        </h1>
        <p className="max-w-2xl text-[1.0625rem] text-ink-soft">
          For apps your AI employee can&apos;t use yet. No code: you choose what it may do, and nothing that changes data runs without
          your approval. (Technically, you get an MCP server, the standard way AI employees use apps.)
        </p>
        <Suspense fallback={null}>
          <FirstRun />
        </Suspense>
        <div className="w-full max-w-5xl text-left">
          <StartBox />
        </div>
      </section>

      <section aria-labelledby="how-title" className="flex flex-col gap-3">
        <div className="flex items-end justify-between">
          <h2 id="how-title" className="text-[1.25rem] font-semibold">
            How it works
          </h2>
          <Link href="/how-it-works" className="inline-flex items-center gap-1 text-sm">
            Learn more <IconArrowRight size={14} />
          </Link>
        </div>
        <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="window flex flex-col gap-2 p-4">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--signal-tint)] text-signal">
                  <s.icon size={18} />
                </span>
                <span className="text-sm text-ink-soft">Step {i + 1}</span>
              </div>
              <h3 className="text-[1.0625rem] font-semibold">{s.title}</h3>
              <p className="flex-1 text-sm text-ink-soft">{s.text}</p>
              <div>
                <AiTag used={s.ai.used} note={"note" in s.ai ? s.ai.note : undefined} />
              </div>
            </li>
          ))}
        </ol>
      </section>

      <Suspense fallback={<p className="text-ink-soft">Loading your apps…</p>}>
        <YourApps />
      </Suspense>
    </AppShell>
  );
}

/** Only in an empty workspace. */
async function FirstRun() {
  await connection();
  const ws = await requireWorkspace();
  const apps = await listConnectors(ws.id);
  return apps.length === 0 ? <Welcome /> : null;
}

async function YourApps() {
  await connection(); // request-time only: never touch the DB (or env) during build
  const ws = await requireWorkspace();
  const apps = await listConnectors(ws.id);
  if (apps.length === 0) return null;
  const [setups, health, waiting, stats] = await Promise.all([
    Promise.all(apps.map((a) => getSetupState(a.id))),
    Promise.all(apps.map((a) => healthSummary(a.id))),
    pendingByConnector(ws.id),
    callStats7d(ws.id),
  ]);

  return (
    <section aria-labelledby="apps-title" className="flex flex-col gap-3">
      <div className="flex items-end justify-between">
        <h2 id="apps-title" className="text-[1.25rem] font-semibold">
          Your apps
        </h2>
        <ButtonLink href="/apps/new" small>
          Add an app
        </ButtonLink>
      </div>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {apps.map((app, i) => {
          const setup = setups[i];
          const s = stats.get(app.id);
          const w = waiting.get(app.id) ?? 0;
          const next = setup?.next;
          return (
            <li key={app.id} className="window flex flex-col gap-3 p-4">
              <div className="flex items-start gap-3">
                <Monogram name={app.name} />
                <div className="min-w-0 flex-1">
                  <Link href={`/apps/${app.id}/review`} className="block truncate text-[1.0625rem] font-semibold text-ink">
                    {app.name}
                  </Link>
                  <p className="text-sm text-ink-soft">
                    {setup ? `${setup.toolsOn} of ${setup.actionsTotal} actions on` : ""} · {app.status === "published" ? "Published" : "Not published"}
                  </p>
                </div>
                {w > 0 && (
                  <Link href="/approvals" className="no-underline hover:no-underline">
                    <Tag tone="red">{w} to approve</Tag>
                  </Link>
                )}
              </div>
              <MetricRow
                items={[
                  { value: s?.calls ?? 0, label: "calls, 7 days" },
                  { value: s?.successRate == null ? "—" : `${Math.round(s.successRate * 100)}%`, label: "worked" },
                  { value: setup ? `${setup.doneCount}/${setup.steps.length}` : "—", label: "setup steps" },
                ]}
              />
              <div className="flex items-center justify-between gap-2">
                {app.status === "published" ? <HealthLabel status={health[i]} /> : <span className="text-sm text-ink-soft">Setup in progress</span>}
                {next ? (
                  <ButtonLink href={next.href} primary small>
                    Next: {next.cta}
                  </ButtonLink>
                ) : (
                  <ButtonLink href={`/apps/${app.id}/health`} small>
                    Open
                  </ButtonLink>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
