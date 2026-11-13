import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { AppCrumb, AppFrame } from "@/components/app-tabs";
import { AiTag, EvidenceLabel, Help, Notice, RiskLabel, Window, formatUsd } from "@/components/ui";
import { getConnectionSummary } from "@/server/connectors/connection";
import { getConnectorForReview } from "@/server/connectors/queries";
import { mcpUrl } from "@/server/origin";
import { PublishBar } from "./publish-bar";
import { ownedConnector } from "@/server/auth/guard";
import { catalogForSource, jobActionIds } from "@/lib/catalog";
import { JobPicker, type JobOption } from "./job-picker";
import { ReviewList, type ReviewAction } from "./review-list";

export const metadata = { title: "Actions · BYOMCP" };

export default function ReviewPage({ params, searchParams }: PageProps<"/apps/[id]/review">) {
  return (
    <AppShell wide crumbs={[{ label: <Suspense fallback="App"><AppCrumb params={params} /></Suspense> }]}>
      <Suspense fallback={<p className="text-ink-soft">Loading actions…</p>}>
        <Review params={params} searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}

async function Review({ params, searchParams }: Pick<PageProps<"/apps/[id]/review">, "params" | "searchParams">) {
  const { id } = await params;
  const sp = await searchParams;
  if (!(await ownedConnector(id))) notFound();
  const data = await getConnectorForReview(id);
  if (!data) notFound();
  const { connector, version, actions } = data;
  const connection = await getConnectionSummary(id);
  const connected = !!connection?.baseUrl && !!connection.authType && (connection.authType === "none" || !!connection.credential);
  const needsReconnect = connection?.credential?.status === "needs_reconnect";

  const rows: ReviewAction[] = actions.map((a) => ({
    id: a.id,
    key: a.key,
    title: a.title,
    description: a.description,
    resource: a.resource,
    method: a.method,
    path: a.path,
    params: a.params,
    risk: a.risk,
    evidence: a.evidence,
    citation: a.citation ?? null,
    enabled: a.enabled,
    requiresApproval: a.requiresApproval,
    lastTestedAt: a.lastTestedAt ? a.lastTestedAt.toISOString() : null,
  }));

  const on = actions.filter((a) => a.enabled).length;
  const cost = Number(version?.importCostUsd ?? 0);
  const detected = version?.detected;
  const editable = version?.status === "draft";
  const viaAi = !!version?.llmModel;

  // Catalog apps: offer jobs ("Answer customer tickets") instead of a list of endpoints.
  const app = catalogForSource(version?.sourceRef);
  const jobs: JobOption[] = (app?.jobs ?? []).map((j) => {
    const ids = new Set(jobActionIds([j], actions));
    const matched = actions.filter((a) => ids.has(a.id));
    return {
      key: j.key,
      title: j.title,
      description: j.description,
      matched: matched.length,
      writes: matched.filter((a) => a.risk !== "read").length,
      on: matched.length > 0 && matched.every((a) => a.enabled),
    };
  });

  return (
    <AppFrame id={id} current="actions">
      {sp.new === "1" && (
        <Notice tone="ok">
          <p className="font-medium">We read the docs and found {actions.length} actions.</p>
          <p className="text-sm">
            {jobs.some((j) => j.matched > 0)
              ? "Pick what your AI employee should do below, and we'll turn on just what that needs."
              : actions.length > 30
                ? "That's a big API, so nothing is on yet. Search for what your AI employee needs and turn just that on."
                : "Reads are on; anything that changes data is off. Look through the list, then follow the Setup panel."}
          </p>
        </Notice>
      )}
      {sp.connected === "1" && connected && <Notice tone="ok">Connected. Now try one read action to check it works.</Notice>}
      {needsReconnect && (
        <Notice tone="alarm">
          {connector.name} rejected the saved key on the last call. Check it&apos;s still valid and has access, then reconnect in Connection.
        </Notice>
      )}

      <Window
        title={
          <>
            What your AI employee can do in {connector.name}{" "}
            <Help label="an action">
              Each action is one thing the app&apos;s API can do, like &quot;Create a ticket&quot;. Turn one on and your AI employee can use it as a tool.
            </Help>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-3">
            <p className="flex flex-col items-start gap-1">
              <RiskLabel risk="read" />
              <span className="text-ink-soft">Looks things up. Runs on its own when it&apos;s on.</span>
            </p>
            <p className="flex flex-col items-start gap-1">
              <RiskLabel risk="write" />
              <span className="text-ink-soft">Creates or updates data. Waits for your approval if &quot;Needs approval&quot; is ticked.</span>
            </p>
            <p className="flex flex-col items-start gap-1">
              <RiskLabel risk="destructive" />
              <span className="text-ink-soft">Deletes or can&apos;t be undone. Always waits for your approval.</span>
            </p>
          </div>
          <p className="flex flex-wrap items-center gap-2 text-ink-soft">
            <span>Why we think each action exists:</span>
            <EvidenceLabel evidence="sourced" /> <EvidenceLabel evidence="tested" /> <EvidenceLabel evidence="needs_review" />
          </p>
          <p className="flex flex-wrap items-center gap-2 border-t border-[var(--separator)] pt-3 text-ink-soft">
            <AiTag used={viaAi} note={viaAi ? `read the docs once: est. ${formatUsd(cost)}` : "read straight from the OpenAPI file: $0"} />
            <span className="min-w-0 break-all">{version?.sourceRef}</span>
          </p>
        </div>
      </Window>

      {version && (
        <div id="publish">
          <PublishBar
            connectorId={id}
            versionNumber={version.version}
            versionStatus={version.status}
            hasLive={!!connector.currentVersionId}
            connected={connected && !needsReconnect}
            onCount={on}
            endpoint={mcpUrl(id)}
          />
        </div>
      )}

      {app && version && <JobPicker appName={connector.name} versionId={version.id} jobs={jobs} editable={editable} />}

      <ReviewList versionId={version?.id ?? ""} actions={rows} connected={connected && !needsReconnect} editable={editable} connectorId={id} autoTry={sp.try === "1"} />

      {((detected && detected.warnings.length > 0) || (version?.skipped && version.skipped.length > 0)) && (
        <details className="window p-4 text-sm">
          <summary className="cursor-pointer font-medium">Notes from reading the docs</summary>
          <ul className="mt-2 list-disc pl-5 text-ink-soft">
            {detected?.warnings.map((w) => <li key={w}>{w}</li>)}
            {version?.skipped?.map((s) => (
              <li key={`${s.method} ${s.path}`}>
                Skipped <span className="font-mono">{s.method} {s.path}</span>: {s.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </AppFrame>
  );
}
