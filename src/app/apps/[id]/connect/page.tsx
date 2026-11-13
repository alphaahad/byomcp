import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { AppCrumb, AppFrame } from "@/components/app-tabs";
import { ButtonLink, Notice, Window } from "@/components/ui";
import { catalogForSource, type CatalogApp } from "@/lib/catalog";
import { ownedConnector } from "@/server/auth/guard";
import { latestConnectionCheck, type ConnectionCheck } from "@/server/connectors/auto-check";
import { getConnectionSummary } from "@/server/connectors/connection";
import { getConnectorForReview } from "@/server/connectors/queries";
import { getSetupState } from "@/server/connectors/setup-state";
import { zendeskOAuthConfig } from "@/server/oauth/zendesk";
import { ConnectForm } from "./connect-form";
import { KeyGuide } from "./key-guide";

export const metadata = { title: "Connect your account · BYOMCP" };

export default function ConnectPage({ params, searchParams }: PageProps<"/apps/[id]/connect">) {
  return (
    <AppShell crumbs={[{ label: <Suspense fallback="App"><AppCrumb params={params} /></Suspense> }]}>
      <Suspense fallback={<p className="text-ink-soft">Loading…</p>}>
        <Connect params={params} searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}

async function Connect({ params, searchParams }: Pick<PageProps<"/apps/[id]/connect">, "params" | "searchParams">) {
  const { id } = await params;
  const sp = await searchParams;
  if (!(await ownedConnector(id))) notFound();
  const data = await getConnectorForReview(id);
  if (!data) notFound();
  const [summary, setup, check] = await Promise.all([getConnectionSummary(id), getSetupState(id), sp.checked === "1" ? latestConnectionCheck(id) : null]);
  const detected = data.version?.detected;
  const app = catalogForSource(data.version?.sourceRef);
  const oauth = zendeskOAuthConfig();
  const found = typeof sp.found === "string" && /^[\w ]{1,40}$/.test(sp.found) ? sp.found : check?.found ?? null;

  // Prefer what the user already saved; then the catalog's known sign-in; then what the import detected.
  const catalogAuth = app && app.auth.type !== "none" ? app.auth : null;
  const initial = {
    baseUrlTemplate: summary?.baseUrl ?? app?.baseUrl ?? detected?.baseUrl ?? "",
    candidates: detected?.baseUrlCandidates ?? [],
    variables: detected?.baseUrlVariables ?? {},
    authType:
      summary?.authType ?? catalogAuth?.type ?? app?.auth.type ?? (detected?.auth.type === "unsupported" ? null : detected?.auth.type) ?? null,
    apiKey:
      summary?.apiKey ??
      (catalogAuth?.type === "api_key" ? { in: catalogAuth.in, name: catalogAuth.name } : undefined) ??
      (detected?.auth.type === "api_key" ? { in: detected.auth.in, name: detected.auth.name } : undefined),
    detectedNote:
      !app && detected?.auth.type === "unsupported"
        ? `The docs describe ${detected.auth.scheme}, which isn't supported yet. Many apps also accept an API key or token: check the app's settings.`
        : undefined,
    credential: summary?.credential ?? null,
  };
  const guide = app
    ? {
        placeholders: app.placeholders ?? {},
        basic: app.auth.type === "basic" ? { username: app.auth.username, password: app.auth.password } : undefined,
      }
    : undefined;

  return (
    <AppFrame id={id} current="settings">
      {check && <CheckResult check={check} found={found} app={app} appName={data.connector.name} next={setup?.next ?? null} />}
      {typeof sp.oauth === "string" && OAUTH_MESSAGES[sp.oauth] && <Notice tone="alarm">{OAUTH_MESSAGES[sp.oauth]}</Notice>}
      {app?.key === "zendesk" && oauth && (
        <Window title="Connect with Zendesk (no key needed)">
          <div className="flex flex-col items-start gap-3 text-sm">
            <p>
              Sign in to <strong>{oauth.subdomain}.zendesk.com</strong> and approve access. Zendesk gives BYOMCP a token that renews itself, so
              there&apos;s nothing to copy and nothing that quietly expires.
              {summary?.credential?.hint?.startsWith("Signed in with") && <> Connected now: {summary.credential.hint}.</>}
            </p>
            <a href={`/api/oauth/zendesk/start?app=${id}`} className="btn btn-primary">
              {summary?.credential?.hint?.startsWith("Signed in with") ? "Sign in again with Zendesk" : "Connect with Zendesk"}
            </a>
            <p className="text-xs text-ink-soft">
              One-click sign-in works for {oauth.subdomain}.zendesk.com, where BYOMCP is registered. For another Zendesk account, use an API token
              below.
            </p>
          </div>
        </Window>
      )}

      <Window title={`Connect your ${data.connector.name} account`} status={["Encrypted at rest (AES-256-GCM)", "Never shown again", "Never sent to AI"]}>
        <div className="flex flex-col gap-4">
          <p className="text-ink-soft">
            Your AI employee acts through this account, so use one with only the access it needs.
            {!app && <> You&apos;ll find keys in the app&apos;s settings, usually under &quot;API&quot;, &quot;Developers&quot; or &quot;Integrations&quot;.</>}
          </p>
          <KeyGuide appName={data.connector.name} app={app} />
          <ConnectForm connectorId={id} initial={initial} guide={guide} />
        </div>
      </Window>
    </AppFrame>
  );
}

const OAUTH_MESSAGES: Record<string, string> = {
  denied: "Zendesk sign-in was cancelled, so nothing changed. Try again, or use an API token below.",
  expired: "That sign-in took too long or was started in another tab. Click Connect with Zendesk again.",
  failed: "Zendesk didn't complete the sign-in. Try again in a minute, or use an API token below.",
  off: "Connect with Zendesk isn't set up on this BYOMCP yet. Use an API token below.",
};

/** "Connected and working ✓", or the one thing to fix. */
function CheckResult({
  check,
  found,
  app,
  appName,
  next,
}: {
  check: ConnectionCheck;
  found: string | null;
  app: CatalogApp | null;
  appName: string;
  next: { href: string; cta: string } | null;
}) {
  if (check.ok) {
    return (
      <Notice tone="ok">
        <p className="font-semibold">✓ Connected and working.</p>
        <p className="text-sm">
          We ran &quot;{check.actionTitle}&quot;{found ? ` and got back ${found}` : " and it worked"}. That action is now marked Tested.
        </p>
        {next && (
          <div className="mt-2">
            <ButtonLink href={next.href} primary small>
              Next: {next.cta}
            </ButtonLink>
          </div>
        )}
      </Notice>
    );
  }
  const placeholder = Object.keys(app?.placeholders ?? {})[0];
  const fix =
    check.status === "auth_failed" && check.httpStatus === 403
      ? `${appName} accepted the key but says it isn't allowed to read this. Ask an admin for a key with read access, or use an admin's key.`
      : check.status === "auth_failed"
        ? `${appName} didn't accept the key. Check you copied all of it (no spaces at the ends)${app?.auth.type === "basic" ? ", and that the username and password are in the right boxes" : ""}, then save again.`
        : check.httpStatus === 404
          ? `Nothing was found at that address. Check the server address${placeholder ? ` and your ${placeholder}` : ""} below, then save again.`
          : check.status === "transient_failed"
            ? `${appName} had a problem answering (${check.reason ?? "try again"}). Wait a minute and save again.`
            : (check.reason ?? "The test call didn't work. Check the details below and save again.");
  return (
    <Notice tone="alarm">
      <p className="font-semibold">Saved, but the test call didn&apos;t work.</p>
      <p className="text-sm">{fix}</p>
      <p className="mt-1 text-xs text-ink-soft">
        We tried &quot;{check.actionTitle}&quot;{check.httpStatus ? ` (HTTP ${check.httpStatus})` : ""}. Nothing was changed in {appName}.
      </p>
    </Notice>
  );
}
