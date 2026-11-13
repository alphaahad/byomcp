import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentWorkspace, ownedConnector } from "@/server/auth/guard";
import { runConnectionCheck } from "@/server/connectors/auto-check";
import { saveConnection } from "@/server/connectors/connection";
import { env } from "@/server/env";
import { assertPublicBaseUrl } from "@/server/net/safe-fetch";
import { verifyState } from "@/server/oauth/state";
import { exchangeZendeskCode, zendeskOAuthConfig } from "@/server/oauth/zendesk";

const OAUTH_COOKIE = "byomcp_oauth";

/**
 * Zendesk sends the user back here. Checked before anything is saved: the
 * signed state (not expired, this workspace, an app it owns), and the PKCE
 * verifier cookie from the same browser. Tokens are encrypted at once and
 * never shown; then the usual "Connected and working" check runs.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const cookie = jar.get(OAUTH_COOKIE)?.value ?? "";
  jar.delete({ name: OAUTH_COOKIE, path: "/api/oauth" });

  const ws = await currentWorkspace();
  if (!ws) return NextResponse.redirect(new URL("/login", url));
  const state = verifyState(url.searchParams.get("state"), env().CREDENTIALS_ENCRYPTION_KEY);
  if (!state || state.workspaceId !== ws.id) return NextResponse.redirect(new URL("/?oauth=expired", url));
  const connector = await ownedConnector(state.connectorId);
  if (!connector) return NextResponse.redirect(new URL("/?oauth=expired", url));

  const back = (status: string) => {
    const b = new URL(`/apps/${connector.id}/connect`, url);
    b.searchParams.set("oauth", status);
    return NextResponse.redirect(b);
  };
  if (url.searchParams.get("error")) return back("denied");

  const [nonce, verifier] = cookie.split(".");
  const code = url.searchParams.get("code");
  if (!code || !verifier || nonce !== state.nonce) return back("expired");
  const cfg = zendeskOAuthConfig();
  if (!cfg) return back("off");

  try {
    const secret = await exchangeZendeskCode(cfg, code, verifier);
    const baseUrl = await assertPublicBaseUrl(`https://${cfg.subdomain}.zendesk.com`);
    const saved = await saveConnection({ connectorId: connector.id, baseUrl, authType: "bearer", secret });
    if (!saved.ok) return back("failed");
  } catch {
    return back("failed");
  }

  const check = await runConnectionCheck(connector.id);
  if (!check.ran) return NextResponse.redirect(new URL(`/apps/${connector.id}/review?connected=1`, url));
  const done = new URL(`/apps/${connector.id}/connect`, url);
  done.searchParams.set("checked", "1");
  if (check.found) done.searchParams.set("found", check.found.slice(0, 40));
  return NextResponse.redirect(done);
}
