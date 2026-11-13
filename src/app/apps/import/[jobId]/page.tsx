import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/ui";
import { ownsImportJob } from "@/server/auth/guard";
import { getImportProgress } from "@/server/import/run-ai-import";
import { ImportProgressView } from "./progress-view";

export const metadata = { title: "Reading the docs · BYOMCP" };

export default function ImportPage({ params }: PageProps<"/apps/import/[jobId]">) {
  return (
    <AppShell crumbs={[{ label: "Add an app", href: "/apps/new" }, { label: "Reading the docs" }]}>
      <PageHeader
        title="Reading the docs"
        lead="AI is reading the docs pages once to list what the app's API can do. This is the only step that uses AI; the estimated cost is shown as it goes."
      />
      <Suspense fallback={<p className="text-ink-soft">Loading…</p>}>
        <Progress params={params} />
      </Suspense>
    </AppShell>
  );
}

async function Progress({ params }: Pick<PageProps<"/apps/import/[jobId]">, "params">) {
  const { jobId } = await params;
  if (!z.uuid().safeParse(jobId).success || !(await ownsImportJob(jobId))) notFound();
  const initial = await getImportProgress(jobId);
  if (!initial) notFound();
  return <ImportProgressView initial={initial} />;
}
