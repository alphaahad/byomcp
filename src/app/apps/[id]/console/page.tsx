import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { AppShell } from "@/components/app-shell";
import { AppCrumb, AppFrame } from "@/components/app-tabs";
import { ButtonLink, Window } from "@/components/ui";
import { mcpUrl } from "@/server/origin";
import { ownedConnector } from "@/server/auth/guard";
import { ConsoleClient } from "./console-client";
import { TalkClient } from "./talk-client";

export const metadata = { title: "MCP test console · BYOMCP" };

export default function ConsolePage({ params }: PageProps<"/apps/[id]/console">) {
  return (
    <AppShell wide crumbs={[{ label: <Suspense fallback="App"><AppCrumb params={params} /></Suspense> }]}>
      <Suspense fallback={<Window title="MCP test console">Loading…</Window>}>
        <Console params={params} />
      </Suspense>
    </AppShell>
  );
}

async function Console({ params }: Pick<PageProps<"/apps/[id]/console">, "params">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const connector = await ownedConnector(id);
  if (!connector) notFound();

  return (
    <AppFrame id={id} current="console">
    {connector.status === "published" && <TalkClient connectorId={id} appName={connector.name} />}
    <Window title="Run a tool yourself" status={["Acts like an AI employee", "MCP 2026-07-28 over HTTP", "No AI involved"]}>
      {connector.status !== "published" ? (
        <div className="flex flex-col items-start gap-3">
          <p>Publish {connector.name} first. The console talks to the published MCP server, exactly as your AI employee would.</p>
          <ButtonLink href={`/apps/${id}/published`} primary>
            Go to Publish
          </ButtonLink>
        </div>
      ) : (
        <ConsoleClient connectorId={id} endpoint={mcpUrl(id)} />
      )}
    </Window>
    </AppFrame>
  );
}
