import { connection } from "next/server";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { ButtonLink, Notice, PageHeader } from "@/components/ui";
import { requireWorkspace } from "@/server/auth/guard";
import { setNotifyEmail, verifyConfirmToken } from "@/server/notify/email";

export const metadata = { title: "Approval alerts · BYOMCP" };

export default function ConfirmPage({ searchParams }: PageProps<"/approvals/confirm">) {
  return (
    <AppShell crumbs={[{ label: "Approvals", href: "/approvals" }, { label: "Email alerts" }]}>
      <PageHeader title="Email alerts" />
      <Suspense fallback={<p className="text-ink-soft">Checking the link…</p>}>
        <Confirm searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}

/** Opened from the confirmation email: turns alerts on for that address, in that workspace only. */
async function Confirm({ searchParams }: Pick<PageProps<"/approvals/confirm">, "searchParams">) {
  await connection();
  const ws = await requireWorkspace();
  const { t } = await searchParams;
  const ok = typeof t === "string" ? verifyConfirmToken(t) : null;
  if (!ok || ok.workspaceId !== ws.id) {
    return (
      <Notice tone="alarm">
        This link has expired or belongs to another workspace. Turn alerts on again from the Approvals page to get a new one.
      </Notice>
    );
  }
  await setNotifyEmail(ws.id, ok.email);
  return (
    <div className="flex flex-col items-start gap-3">
      <Notice tone="ok">✓ Alerts are on: we&apos;ll email {ok.email} when a request is waiting for approval.</Notice>
      <ButtonLink href="/approvals" primary>
        Go to Approvals
      </ButtonLink>
    </div>
  );
}
