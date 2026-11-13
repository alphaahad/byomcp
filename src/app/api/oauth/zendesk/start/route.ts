import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentWorkspace, ownedConnector } from "@/server/auth/guard";
import { env } from "@/server/env";
import { STATE_TTL_MS, newNonce, newPkce, signState } from "@/server/oauth/state";
import { zendeskAuthorizeUrl, zendeskOAuthConfig } from "@/server/oauth/zendesk";

const OAUTH_COOKIE = "byomcp_oauth";

/** "Connect with Zendesk": send the signed-in user to Zendesk's consent screen. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ws = await currentWorkspace();
  if (!ws) return NextResponse.redirect(new URL("/login", url));
  const connectorId = url.searchParams.get("app");
  const connector = await ownedConnector(connectorId);
  if (!connector) return NextResponse.json({ error: "App not found." }, { status: 404 });
  const back = new URL(`/apps/${connector.id}/connect`, url);

  const cfg = zendeskOAuthConfig();
  if (!cfg) {
    back.searchParams.set("oauth", "off");
    return NextResponse.redirect(back);
  }

  const { verifier, challenge } = newPkce();
  const nonce = newNonce();
  const state = signState({ workspaceId: ws.id, connectorId: connector.id, nonce, exp: Date.now() + STATE_TTL_MS }, env().CREDENTIALS_ENCRYPTION_KEY);
  // The PKCE verifier stays in this browser only, tied to this attempt by the nonce.
  (await cookies()).set(OAUTH_COOKIE, `${nonce}.${verifier}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/oauth",
    maxAge: STATE_TTL_MS / 1000,
  });
  return NextResponse.redirect(zendeskAuthorizeUrl(cfg, state, challenge));
}
