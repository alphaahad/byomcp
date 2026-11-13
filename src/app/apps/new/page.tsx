import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { PageHeader, Window } from "@/components/ui";
import { NewAppForm } from "./new-app-form";

export const metadata = { title: "Add an app · BYOMCP" };

// Server actions on this page import whole specs (Zendesk: 2.4 MB, 675 actions, ~15 s).
export const maxDuration = 60;

export default function NewAppPage({ searchParams }: PageProps<"/apps/new">) {
  return (
    <AppShell crumbs={[{ label: "Add an app" }]}>
      <PageHeader
        title="Add an app"
        lead="Bring the app's API docs. We list everything your AI employee could do with it; you choose what to turn on next. Most people just paste a link on Home: this page is for files and pasted text."
      />
      <Window title="Where are the docs?" status={["AI is used once, only for docs pages and pasted text", "Running the app never calls AI"]}>
        <Suspense fallback={<NewAppForm />}>
          <FormWithPrefill searchParams={searchParams} />
        </Suspense>
      </Window>
    </AppShell>
  );
}

async function FormWithPrefill({ searchParams }: Pick<PageProps<"/apps/new">, "searchParams">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const source = one(sp.source);
  const url = one(sp.url);
  return (
    <NewAppForm
      prefill={{
        source: source === "openapi" || source === "docs" || source === "text" ? source : undefined,
        url: url && /^https:\/\//.test(url) ? url.slice(0, 500) : undefined,
      }}
    />
  );
}
