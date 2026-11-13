import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { AppShell } from "@/components/app-shell";
import { AppCrumb, AppFrame } from "@/components/app-tabs";
import { ButtonLink, Notice, Stamp, Window } from "@/components/ui";
import { mcpUrl } from "@/server/origin";
import { listVersions } from "@/server/publish/publish";
import { activeToken } from "@/server/publish/tokens";
import { getConnectionSummary } from "@/server/connectors/connection";
import { getSetupState, lastMcpCallAt } from "@/server/connectors/setup-state";
import { PublishBar } from "../review/publish-bar";
import { ownedConnector } from "@/server/auth/guard";
import { timeAgo } from "@/lib/time-ago";
import { Handoff } from "./handoff";
import { TokenPanel } from "./token-panel";

export const metadata = { title: "Published · BYOMCP" };

export default function PublishedPage({ params }: PageProps<"/apps/[id]/published">) {
  return (
    <AppShell crumbs={[{ label: <Suspense fallback="App"><AppCrumb params={params} /></Suspense> }]}>
      <Suspense fallback={<p className="text-ink-soft">Loading…</p>}>
        <Published params={params} />
      </Suspense>
    </AppShell>
  );
}

async function Published({ params }: Pick<PageProps<"/apps/[id]/published">, "params">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const connector = await ownedConnector(id);
  if (!connector) notFound();
  const [versions, token] = await Promise.all([listVersions(id), activeToken(id)]);
  const live = versions.find((v) => v.status === "published");
  const draft = versions.find((v) => v.status === "draft");
  const endpoint = mcpUrl(id);
  const [connection, setup, lastCall] = await Promise.all([getConnectionSummary(id), getSetupState(id), lastMcpCallAt(id)]);
  const connected =
    !!connection?.baseUrl && !!connection.authType && (connection.authType === "none" || !!connection.credential) && connection.credential?.status !== "needs_reconnect";
  const latest = versions[0];
  const publishBar = latest ? (
    <PublishBar
      connectorId={id}
      versionNumber={latest.version}
      versionStatus={latest.status}
      hasLive={!!live}
      connected={connected}
      onCount={setup?.toolsOn ?? 0}
      endpoint={endpoint}
    />
  ) : null;

  if (!live) {
    return (
      <AppFrame id={id} current="endpoint">
        <Window title="Not published yet">
          <div className="flex flex-col items-start gap-3">
            <p className="text-ink-soft">
              Publishing gives you an MCP address and a token. Paste them into UnleashX (or Claude, or any MCP client) and your AI
              employee can use the actions you turned on, and only those.
            </p>
            <div className="w-full">{publishBar}</div>
          </div>
        </Window>
      </AppFrame>
    );
  }

  return (
    <AppFrame id={id} current="endpoint">
    <Window
      title={`${connector.name} is published`}
      titleRight={<Stamp tone="ok">Published</Stamp>}
      status={[`Version ${live.version} live`, `${live.tools} tools`, draft ? `Version ${draft.version} draft not published` : "No unpublished changes", "Runtime $0.00 per call"]}
    >
      <div className="flex flex-col gap-5">
        {lastCall ? (
          <Notice tone="ok">✓ Your AI employee used it {timeAgo(lastCall)}.</Notice>
        ) : (
          <Notice tone="info">Waiting for the first call. Follow the 3 steps below, or try it yourself in the Test console.</Notice>
        )}

        <p>
          Your AI employee can now use {connector.name} through this MCP address. It offers {live.tools} tools: only the actions you
          turned on. Anything that changes data waits for your approval where you asked for it.
        </p>

        {draft && publishBar}

        <TokenPanel
          connectorId={id}
          endpoint={endpoint}
          activePrefix={token?.prefix ?? null}
          lastUsedAt={token?.lastUsedAt ? token.lastUsedAt.toISOString() : null}
          allowUrlToken={connector.allowUrlToken}
        />

        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/apps/${id}/console`} primary>
            Open the test console
          </ButtonLink>
          <ButtonLink href={`/apps/${id}/review`}>Review actions</ButtonLink>
        </div>

        <Handoff appName={connector.name} endpoint={endpoint} tools={live.tools} />

        <fieldset className="groupbox">
          <legend>Versions</legend>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--separator)]">
                <th className="py-1 pr-3 font-semibold">Version</th>
                <th className="py-1 pr-3 font-semibold">Status</th>
                <th className="py-1 pr-3 font-semibold">Tools</th>
                <th className="py-1 font-semibold">Published</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} className="border-b border-[var(--separator)]">
                  <td className="py-1 pr-3 font-mono">v{v.version}</td>
                  <td className="py-1 pr-3">{v.status === "published" ? "Live" : v.status === "draft" ? "Draft" : "Replaced"}</td>
                  <td className="py-1 pr-3 font-mono">{v.tools}</td>
                  <td className="py-1">{v.publishedAt ? v.publishedAt.toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {draft && (
            <p className="mt-2 text-sm">
              You have unpublished changes in v{draft.version}. <Link href={`/apps/${id}/review`}>Review and publish them</Link>.
            </p>
          )}
        </fieldset>
      </div>
    </Window>
    </AppFrame>
  );
}
